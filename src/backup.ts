import type { Context, Hono } from 'hono';
import type { AppBindings } from './types';
import { recordAuditLog } from './audit';
import { queueRemoteJson } from './dual_write';
import {
  decryptCustomFieldRows,
  decryptPersonRow,
  encryptProtectedValue,
  migratePlaintextCustomFieldRows,
  migratePlaintextPersonRow,
  protectPersonWriteFields
} from './data_protection';
import { DEFAULT_LAYER_ID, DEFAULT_LAYER_NAME, ensureLayerSchemaSupport } from './layers';

const BACKUP_VERSION = 2;
const RELATIONSHIP_TYPES = new Set(['parent_child', 'spouse', 'ex_spouse', 'sibling', 'in_law']);
const GENDERS = new Set(['M', 'F', 'O']);

type BackupLayer = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type BackupPerson = {
  id: string;
  layer_id: string;
  name: string;
  english_name: string | null;
  email: string | null;
  gender: 'M' | 'F' | 'O';
  blood_type: string | null;
  dob: string | null;
  dod: string | null;
  tob: string | null;
  tod: string | null;
  avatar_url: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
};

type BackupAvatar = {
  id: string;
  person_id: string;
  avatar_url: string;
  storage_key: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type BackupRelationship = {
  id: number | null;
  layer_id: string;
  from_person_id: string;
  to_person_id: string;
  type: string;
  metadata: string | null;
  created_at: string;
};

type BackupCustomField = {
  id: number | null;
  person_id: string;
  label: string;
  value: string;
  created_at: string;
  updated_at: string;
};

type BackupRelationshipTypeLabel = {
  type: string;
  label: string;
  description: string;
  created_at: string;
  updated_at: string;
};

type BackupKinshipLabel = {
  default_title: string;
  default_formal_title: string;
  custom_title: string | null;
  custom_formal_title: string | null;
  description: string;
  created_at: string;
  updated_at: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const ensureAdmin = (c: Context<AppBindings>) => {
  const sessionUser = c.get('sessionUser');
  if (!sessionUser || sessionUser.role !== 'admin') {
    return false;
  }
  return true;
};

const asString = (value: unknown, field: string) => {
  if (typeof value !== 'string') {
    throw new Error(`Invalid field "${field}"`);
  }
  return value;
};

const asNullableString = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error('Invalid nullable string field');
  }
  return value;
};

const asOptionalTimestamp = (value: unknown, fallback: string) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new Error('Invalid timestamp field');
  }
  return value;
};

const asNullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Invalid numeric field');
  }
  return Math.trunc(parsed);
};

const asJsonText = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    JSON.parse(trimmed);
    return trimmed;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  throw new Error('Invalid JSON field');
};

const asBoolean = (value: unknown) => {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw new Error('Invalid boolean field');
};

const requireArrayField = (
  source: Record<string, unknown>,
  field: string
) => {
  const value = source[field];
  if (!Array.isArray(value)) {
    throw new Error(`Field "${field}" must be an array`);
  }
  return value;
};

const extractDataEnvelope = (body: unknown) => {
  if (!isRecord(body)) {
    throw new Error('Invalid backup payload');
  }
  if (isRecord(body.data)) {
    return body.data;
  }
  return body;
};

const parseLayers = (input: unknown[], now: string): BackupLayer[] => {
  const seen = new Set<string>();
  return input.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Invalid layers[${index}]`);
    const id = asString(row.id, `layers[${index}].id`);
    if (seen.has(id)) {
      throw new Error(`Duplicate layer id "${id}"`);
    }
    seen.add(id);
    return {
      id,
      name: asString(row.name, `layers[${index}].name`),
      description: asNullableString(row.description),
      created_at: asOptionalTimestamp(row.created_at, now),
      updated_at: asOptionalTimestamp(row.updated_at, now),
    };
  });
};

const parsePeople = (input: unknown[], now: string): BackupPerson[] => {
  const seen = new Set<string>();
  return input.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Invalid people[${index}]`);
    const id = asString(row.id, `people[${index}].id`);
    if (seen.has(id)) {
      throw new Error(`Duplicate person id "${id}"`);
    }
    seen.add(id);
    const name = asString(row.name, `people[${index}].name`);
    const rawGender = row.gender === undefined || row.gender === null ? 'O' : row.gender;
    const gender = asString(rawGender, `people[${index}].gender`);
    if (!GENDERS.has(gender)) {
      throw new Error(`Invalid gender for person "${id}"`);
    }
    return {
      id,
      layer_id: typeof row.layer_id === 'string' && row.layer_id.trim() ? row.layer_id.trim() : DEFAULT_LAYER_ID,
      name,
      english_name: asNullableString(row.english_name),
      email: asNullableString(row.email),
      gender: gender as 'M' | 'F' | 'O',
      blood_type: asNullableString(row.blood_type),
      dob: asNullableString(row.dob),
      dod: asNullableString(row.dod),
      tob: asNullableString(row.tob),
      tod: asNullableString(row.tod),
      avatar_url: asNullableString(row.avatar_url),
      metadata: asJsonText(row.metadata),
      created_at: asOptionalTimestamp(row.created_at, now),
      updated_at: asOptionalTimestamp(row.updated_at, now),
    };
  });
};

const parseAvatars = (input: unknown[], now: string): BackupAvatar[] => {
  return input.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Invalid person_avatars[${index}]`);
    const sortOrder = row.sort_order === undefined ? index : asNullableNumber(row.sort_order);
    return {
      id: asString(row.id, `person_avatars[${index}].id`),
      person_id: asString(row.person_id, `person_avatars[${index}].person_id`),
      avatar_url: asString(row.avatar_url, `person_avatars[${index}].avatar_url`),
      storage_key: asNullableString(row.storage_key),
      is_primary: row.is_primary === undefined ? false : asBoolean(row.is_primary),
      sort_order: sortOrder === null ? index : sortOrder,
      created_at: asOptionalTimestamp(row.created_at, now),
      updated_at: asOptionalTimestamp(row.updated_at, now),
    };
  });
};

const parseRelationships = (input: unknown[], now: string): BackupRelationship[] => {
  return input.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Invalid relationships[${index}]`);
    const type = asString(row.type, `relationships[${index}].type`);
    if (!RELATIONSHIP_TYPES.has(type)) {
      throw new Error(`Invalid relationship type "${type}"`);
    }
    return {
      id: asNullableNumber(row.id),
      layer_id: typeof row.layer_id === 'string' && row.layer_id.trim() ? row.layer_id.trim() : DEFAULT_LAYER_ID,
      from_person_id: asString(row.from_person_id, `relationships[${index}].from_person_id`),
      to_person_id: asString(row.to_person_id, `relationships[${index}].to_person_id`),
      type,
      metadata: asJsonText(row.metadata),
      created_at: asOptionalTimestamp(row.created_at, now),
    };
  });
};

const parseCustomFields = (input: unknown[], now: string): BackupCustomField[] => {
  return input.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Invalid person_custom_fields[${index}]`);
    return {
      id: asNullableNumber(row.id),
      person_id: asString(row.person_id, `person_custom_fields[${index}].person_id`),
      label: asString(row.label, `person_custom_fields[${index}].label`),
      value: asString(row.value, `person_custom_fields[${index}].value`),
      created_at: asOptionalTimestamp(row.created_at, now),
      updated_at: asOptionalTimestamp(row.updated_at, now),
    };
  });
};

const parseRelationshipTypeLabels = (input: unknown[], now: string): BackupRelationshipTypeLabel[] => {
  return input.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Invalid relationship_type_labels[${index}]`);
    const type = asString(row.type, `relationship_type_labels[${index}].type`);
    if (!RELATIONSHIP_TYPES.has(type)) {
      throw new Error(`Invalid relationship type label key "${type}"`);
    }
    return {
      type,
      label: asString(row.label, `relationship_type_labels[${index}].label`),
      description: typeof row.description === 'string' ? row.description : '',
      created_at: asOptionalTimestamp(row.created_at, now),
      updated_at: asOptionalTimestamp(row.updated_at, now),
    };
  });
};

const parseKinshipLabels = (input: unknown[], now: string): BackupKinshipLabel[] => {
  return input.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Invalid kinship_labels[${index}]`);
    return {
      default_title: asString(row.default_title, `kinship_labels[${index}].default_title`),
      default_formal_title: asString(row.default_formal_title, `kinship_labels[${index}].default_formal_title`),
      custom_title: asNullableString(row.custom_title),
      custom_formal_title: asNullableString(row.custom_formal_title),
      description: typeof row.description === 'string' ? row.description : '',
      created_at: asOptionalTimestamp(row.created_at, now),
      updated_at: asOptionalTimestamp(row.updated_at, now),
    };
  });
};

const validateRelations = (
  layers: BackupLayer[],
  people: BackupPerson[],
  avatars: BackupAvatar[],
  relationships: BackupRelationship[],
  customFields: BackupCustomField[]
) => {
  const layerIds = new Set(layers.map((layer) => layer.id));
  const personIds = new Set(people.map((person) => person.id));
  for (const person of people) {
    if (!layerIds.has(person.layer_id)) {
      throw new Error(`Person "${person.id}" references unknown layer "${person.layer_id}"`);
    }
  }
  for (const avatar of avatars) {
    if (!personIds.has(avatar.person_id)) {
      throw new Error(`Avatar references unknown person "${avatar.person_id}"`);
    }
  }
  for (const relation of relationships) {
    if (!layerIds.has(relation.layer_id)) {
      throw new Error(`Relationship references unknown layer "${relation.layer_id}"`);
    }
    if (!personIds.has(relation.from_person_id) || !personIds.has(relation.to_person_id)) {
      throw new Error(`Relationship references unknown person: ${relation.from_person_id} -> ${relation.to_person_id}`);
    }
    const fromPerson = people.find((person) => person.id === relation.from_person_id);
    const toPerson = people.find((person) => person.id === relation.to_person_id);
    if (!fromPerson || !toPerson || fromPerson.layer_id !== relation.layer_id || toPerson.layer_id !== relation.layer_id) {
      throw new Error(`Relationship crosses layers: ${relation.from_person_id} -> ${relation.to_person_id}`);
    }
    if (relation.from_person_id === relation.to_person_id) {
      throw new Error('Relationship cannot reference the same person');
    }
  }
  for (const field of customFields) {
    if (!personIds.has(field.person_id)) {
      throw new Error(`Custom field references unknown person "${field.person_id}"`);
    }
  }

  const primaryPerPerson = new Map<string, number>();
  for (const avatar of avatars) {
    if (!avatar.is_primary) continue;
    const count = (primaryPerPerson.get(avatar.person_id) || 0) + 1;
    primaryPerPerson.set(avatar.person_id, count);
    if (count > 1) {
      throw new Error(`Person "${avatar.person_id}" has multiple primary avatars`);
    }
  }
};

export function registerBackupRoutes(app: Hono<AppBindings>) {
  let peopleSchemaSupportPromise: Promise<{ hasEmail: boolean }> | null = null;
  const getPeopleSchemaSupport = async (db: D1Database) => {
    if (!peopleSchemaSupportPromise) {
      peopleSchemaSupportPromise = (async () => {
        const pragma = await db.prepare("PRAGMA table_info('people')").all();
        const names = new Set((pragma.results as Array<Record<string, unknown>>).map((row) => String((row as any).name)));
        if (!names.has('email')) {
          await db.prepare('ALTER TABLE people ADD COLUMN email TEXT').run();
          names.add('email');
        }
        return { hasEmail: names.has('email') };
      })().catch((error) => {
        peopleSchemaSupportPromise = null;
        throw error;
      });
    }
    return peopleSchemaSupportPromise;
  };

  app.get('/api/admin/backup/export', async (c) => {
    if (!ensureAdmin(c)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await ensureLayerSchemaSupport(c.env.DB);
    const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
    const [
      layersResult,
      peopleResult,
      avatarsResult,
      relationshipsResult,
      customFieldsResult,
      relationTypeLabelsResult,
      kinshipLabelsResult,
    ] = await Promise.all([
      c.env.DB.prepare(
        'SELECT id, name, description, created_at, updated_at FROM graph_layers ORDER BY created_at ASC, id ASC'
      ).all(),
      c.env.DB.prepare(
        `SELECT id, layer_id, name, english_name, ${peopleSchema.hasEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people ORDER BY layer_id ASC, created_at ASC, id ASC`
      ).all(),
      c.env.DB.prepare(
        'SELECT id, person_id, avatar_url, storage_key, is_primary, sort_order, created_at, updated_at FROM person_avatars ORDER BY person_id ASC, sort_order ASC, created_at ASC'
      ).all(),
      c.env.DB.prepare(
        'SELECT id, layer_id, from_person_id, to_person_id, type, metadata, created_at FROM relationships ORDER BY layer_id ASC, id ASC'
      ).all(),
      c.env.DB.prepare(
        'SELECT id, person_id, label, value, created_at, updated_at FROM person_custom_fields ORDER BY person_id ASC, id ASC'
      ).all(),
      c.env.DB.prepare(
        'SELECT type, label, description, created_at, updated_at FROM relationship_type_labels ORDER BY type ASC'
      ).all(),
      c.env.DB.prepare(
        'SELECT default_title, default_formal_title, custom_title, custom_formal_title, description, created_at, updated_at FROM kinship_labels ORDER BY default_title ASC, default_formal_title ASC'
      ).all(),
    ]);
    await Promise.all((peopleResult.results as any[]).map((row) => migratePlaintextPersonRow(c.env.DB, c.env, row as Record<string, unknown>)));
    await migratePlaintextCustomFieldRows(c.env.DB, c.env, customFieldsResult.results as Array<Record<string, unknown>>);
    const decryptedPeople = await Promise.all((peopleResult.results as any[]).map((row) => decryptPersonRow(c.env, row as Record<string, unknown>)));
    const decryptedCustomFields = await decryptCustomFieldRows(c.env, customFieldsResult.results as Array<Record<string, unknown>>);

    const sessionUser = c.get('sessionUser');
    const payload = {
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      exported_by: sessionUser?.username || null,
      layers: layersResult.results.map((row: any) => ({
        id: String(row.id),
        name: String(row.name),
        description: row.description === null ? null : String(row.description),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
      })),
      people: decryptedPeople.map((row: any) => ({
        id: String(row.id),
        layer_id: String(row.layer_id ?? DEFAULT_LAYER_ID),
        name: String(row.name),
        english_name: row.english_name === null ? null : String(row.english_name),
        email: row.email === null || row.email === undefined ? null : String(row.email),
        gender: row.gender === 'M' || row.gender === 'F' ? row.gender : 'O',
        blood_type: row.blood_type === null ? null : String(row.blood_type),
        dob: row.dob === null ? null : String(row.dob),
        dod: row.dod === null ? null : String(row.dod),
        tob: row.tob === null ? null : String(row.tob),
        tod: row.tod === null ? null : String(row.tod),
        avatar_url: row.avatar_url === null ? null : String(row.avatar_url),
        metadata: row.metadata === null ? null : String(row.metadata),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
      })),
      person_avatars: avatarsResult.results.map((row: any) => ({
        id: String(row.id),
        person_id: String(row.person_id),
        avatar_url: String(row.avatar_url),
        storage_key: row.storage_key === null ? null : String(row.storage_key),
        is_primary: Number(row.is_primary) === 1,
        sort_order: Number(row.sort_order ?? 0),
        created_at: row.created_at === null ? null : String(row.created_at),
        updated_at: row.updated_at === null ? null : String(row.updated_at),
      })),
      relationships: relationshipsResult.results.map((row: any) => ({
        id: Number(row.id),
        layer_id: String(row.layer_id ?? DEFAULT_LAYER_ID),
        from_person_id: String(row.from_person_id),
        to_person_id: String(row.to_person_id),
        type: String(row.type),
        metadata: row.metadata === null ? null : String(row.metadata),
        created_at: String(row.created_at),
      })),
      person_custom_fields: decryptedCustomFields.map((row: any) => ({
        id: Number(row.id),
        person_id: String(row.person_id),
        label: String(row.label),
        value: String(row.value),
        created_at: row.created_at === null ? null : String(row.created_at),
        updated_at: row.updated_at === null ? null : String(row.updated_at),
      })),
      relationship_type_labels: relationTypeLabelsResult.results.map((row: any) => ({
        type: String(row.type),
        label: String(row.label),
        description: String(row.description ?? ''),
        created_at: row.created_at === null ? null : String(row.created_at),
        updated_at: row.updated_at === null ? null : String(row.updated_at),
      })),
      kinship_labels: kinshipLabelsResult.results.map((row: any) => ({
        default_title: String(row.default_title),
        default_formal_title: String(row.default_formal_title),
        custom_title: row.custom_title === null ? null : String(row.custom_title),
        custom_formal_title: row.custom_formal_title === null ? null : String(row.custom_formal_title),
        description: String(row.description ?? ''),
        created_at: row.created_at === null ? null : String(row.created_at),
        updated_at: row.updated_at === null ? null : String(row.updated_at),
      })),
    };

    await recordAuditLog(c, {
      action: 'export_backup',
      resourceType: 'graph',
      summary: `匯出節點備份（${payload.people.length} 節點）`,
      details: {
          people: payload.people.length,
          layers: payload.layers.length,
          avatars: payload.person_avatars.length,
        relationships: payload.relationships.length,
        custom_fields: payload.person_custom_fields.length,
      }
    });

    return c.json(payload);
  });

  app.post('/api/admin/backup/import', async (c) => {
    if (!ensureAdmin(c)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    try {
      const body = await c.req.json();
      const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
      const source = extractDataEnvelope(body);
      const now = new Date().toISOString();
      await ensureLayerSchemaSupport(c.env.DB);

      const layers = Array.isArray(source.layers)
        ? parseLayers(source.layers as unknown[], now)
        : [{
          id: DEFAULT_LAYER_ID,
          name: DEFAULT_LAYER_NAME,
          description: 'Legacy backup default layer',
          created_at: now,
          updated_at: now,
        }];
      const people = parsePeople(requireArrayField(source, 'people'), now);
      const avatars = parseAvatars(requireArrayField(source, 'person_avatars'), now);
      const relationships = parseRelationships(requireArrayField(source, 'relationships'), now);
      const customFields = parseCustomFields(requireArrayField(source, 'person_custom_fields'), now);
      const hasRelationshipTypeLabels = Array.isArray(source.relationship_type_labels);
      const hasKinshipLabels = Array.isArray(source.kinship_labels);
      const relationshipTypeLabels = hasRelationshipTypeLabels
        ? parseRelationshipTypeLabels(source.relationship_type_labels as unknown[], now)
        : [];
      const kinshipLabels = hasKinshipLabels
        ? parseKinshipLabels(source.kinship_labels as unknown[], now)
        : [];

      validateRelations(layers, people, avatars, relationships, customFields);

      // Pre-encrypt custom fields so we can batch them
      const encryptedCustomFields = await Promise.all(
        customFields.map(async (field) => ({
          ...field,
          encryptedValue: await encryptProtectedValue(c.env, field.value)
        }))
      );

      // Pre-compute primary avatars
      const avatarPersonIds = [...new Set(avatars.map((avatar) => avatar.person_id))];
      const primaryAvatars = new Map<string, string | null>();
      for (const personId of avatarPersonIds) {
        const personAvatars = avatars.filter(a => a.person_id === personId);
        personAvatars.sort((a, b) => {
          if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        primaryAvatars.set(personId, personAvatars[0]?.avatar_url ?? null);
      }

      // Pre-protect people fields
      const protectedPeople = await Promise.all(
        people.map(async (person) => {
          const protectedFields = await protectPersonWriteFields(c.env, {
            blood_type: person.blood_type,
            dob: person.dob,
            dod: person.dod,
            tob: person.tob,
            tod: person.tod,
            metadata: person.metadata
          });
          return { person, protectedFields };
        })
      );

      const stmts: any[] = [];

      stmts.push(c.env.DB.prepare('DELETE FROM graph_layers'));
      stmts.push(c.env.DB.prepare('DELETE FROM relationships'));
      stmts.push(c.env.DB.prepare('DELETE FROM person_custom_fields'));
      stmts.push(c.env.DB.prepare('DELETE FROM person_avatars'));
      stmts.push(c.env.DB.prepare('DELETE FROM people'));
      if (hasRelationshipTypeLabels) {
        stmts.push(c.env.DB.prepare('DELETE FROM relationship_type_labels'));
      }
      if (hasKinshipLabels) {
        stmts.push(c.env.DB.prepare('DELETE FROM kinship_labels'));
      }

      for (const layer of layers) {
        stmts.push(c.env.DB.prepare(
          `INSERT INTO graph_layers (id, name, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          layer.id, layer.name, layer.description, layer.created_at, layer.updated_at
        ));
      }

      for (const { person, protectedFields } of protectedPeople) {
        stmts.push(c.env.DB.prepare(
          `INSERT INTO people (
            id, name, english_name${peopleSchema.hasEmail ? ', email' : ''}, gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at
          , layer_id) VALUES (${peopleSchema.hasEmail ? '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?' : '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?'})`
        ).bind(
          person.id,
          person.name,
          person.english_name,
          ...(peopleSchema.hasEmail ? [person.email] : []),
          person.gender,
          protectedFields.blood_type ?? null,
          protectedFields.dob ?? null,
          protectedFields.dod ?? null,
          protectedFields.tob ?? null,
          protectedFields.tod ?? null,
          person.avatar_url,
          protectedFields.metadata ?? null,
          person.created_at,
          person.updated_at,
          person.layer_id
        ));
      }

      for (const avatar of avatars) {
        stmts.push(c.env.DB.prepare(
          `INSERT INTO person_avatars (
            id, person_id, avatar_url, storage_key, is_primary, sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          avatar.id,
          avatar.person_id,
          avatar.avatar_url,
          avatar.storage_key,
          avatar.is_primary ? 1 : 0,
          avatar.sort_order,
          avatar.created_at,
          avatar.updated_at
        ));
      }

      for (const field of encryptedCustomFields) {
        if (field.id !== null) {
          stmts.push(c.env.DB.prepare(
            `INSERT INTO person_custom_fields (
              id, person_id, label, value, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            field.id,
            field.person_id,
            field.label,
            field.encryptedValue,
            field.created_at,
            field.updated_at
          ));
        } else {
          stmts.push(c.env.DB.prepare(
            `INSERT INTO person_custom_fields (
              person_id, label, value, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)`
          ).bind(
            field.person_id,
            field.label,
            field.encryptedValue,
            field.created_at,
            field.updated_at
          ));
        }
      }

      for (const relation of relationships) {
        if (relation.id !== null) {
          stmts.push(c.env.DB.prepare(
            `INSERT INTO relationships (
              id, from_person_id, to_person_id, type, metadata, created_at
            , layer_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            relation.id,
            relation.from_person_id,
            relation.to_person_id,
            relation.type,
            relation.metadata,
            relation.created_at,
            relation.layer_id
          ));
        } else {
          stmts.push(c.env.DB.prepare(
            `INSERT INTO relationships (
              from_person_id, to_person_id, type, metadata, created_at, layer_id
            ) VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            relation.from_person_id,
            relation.to_person_id,
            relation.type,
            relation.metadata,
            relation.created_at,
            relation.layer_id
          ));
        }
      }

      if (hasRelationshipTypeLabels) {
        for (const item of relationshipTypeLabels) {
          stmts.push(c.env.DB.prepare(
            `INSERT INTO relationship_type_labels (
              type, label, description, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)`
          ).bind(
            item.type,
            item.label,
            item.description,
            item.created_at,
            item.updated_at
          ));
        }
      }

      if (hasKinshipLabels) {
        for (const item of kinshipLabels) {
          stmts.push(c.env.DB.prepare(
            `INSERT INTO kinship_labels (
              default_title, default_formal_title, custom_title, custom_formal_title, description, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            item.default_title,
            item.default_formal_title,
            item.custom_title,
            item.custom_formal_title,
            item.description,
            item.created_at,
            item.updated_at
          ));
        }
      }

      for (const [personId, avatarUrl] of primaryAvatars) {
        stmts.push(c.env.DB.prepare(
          'UPDATE people SET avatar_url = ? WHERE id = ?'
        ).bind(avatarUrl, personId));
      }

      // Execute all statements in a single batch transaction
      // Note: If backups become extremely large, this might need chunking. 
      // But D1 batch is the required way for DO atomicity.
      await c.env.DB.batch(stmts);


      await recordAuditLog(c, {
        action: 'import_backup',
        resourceType: 'graph',
        summary: `匯入節點備份（${people.length} 節點）`,
        details: {
          people: people.length,
          layers: layers.length,
          avatars: avatars.length,
          relationships: relationships.length,
          custom_fields: customFields.length,
          relationship_type_labels: relationshipTypeLabels.length,
          kinship_labels: kinshipLabels.length,
        }
      });

      queueRemoteJson(c, 'POST', '/api/admin/backup/import', body);

      return c.json({
        success: true,
        version: BACKUP_VERSION,
        counts: {
          people: people.length,
          layers: layers.length,
          avatars: avatars.length,
          relationships: relationships.length,
          custom_fields: customFields.length,
          relationship_type_labels: relationshipTypeLabels.length,
          kinship_labels: kinshipLabels.length,
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed';
      return c.json({ error: message }, 400);
    }
  });
}
