import type { Context, Hono } from 'hono';
import type { AppBindings, Env } from './types';
import { safeParse } from './utils';
import { notifyUpdate } from './notify';
import { queueRemoteFormData, queueRemoteJson } from './dual_write';
import { recordAuditLog } from './audit';
import { buildSiblingLinkMeta } from './relationship_utils';
import {
  decryptCustomFieldRows,
  decryptPersonRow,
  decryptProtectedValue,
  migratePlaintextCustomFieldRows,
  migratePlaintextPersonRow,
  protectPersonWriteFields,
  encryptProtectedValue
} from './data_protection';
import { assertLayerExists, ensureLayerSchemaSupport, resolveLayerId } from './layers';

type UploadFile = Blob & {
  name?: string;
  size: number;
  type: string;
  stream: () => ReadableStream;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type PersonAvatar = {
  id: string;
  person_id: string;
  avatar_url: string;
  storage_key: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
};

const isUploadFile = (value: unknown): value is UploadFile => (
  Boolean(value)
  && typeof value !== 'string'
  && typeof (value as Blob).arrayBuffer === 'function'
  && typeof (value as Blob).stream === 'function'
);

async function updateSiblingOrdering(env: Env, personId: string, layerId: string) {
  const db = env.DB;
  const person = await db.prepare(
    'SELECT id, dob FROM people WHERE id = ? AND layer_id = ?'
  ).bind(personId, layerId).first();

  const personDob = person && (person as any).dob
    ? new Date((await decryptProtectedValue(env, (person as any).dob as string | null)) || '').getTime()
    : 0;
  if (!personDob) return;

  const { results } = await db.prepare(
    "SELECT id, from_person_id, to_person_id FROM relationships WHERE layer_id = ? AND type = 'sibling' AND (from_person_id = ? OR to_person_id = ?)"
  ).bind(layerId, personId, personId).all();

  for (const rel of results) {
    const relAny = rel as any;
    const otherId = relAny.from_person_id === personId ? relAny.to_person_id : relAny.from_person_id;
    const other = await db.prepare(
      'SELECT id, dob FROM people WHERE id = ? AND layer_id = ?'
    ).bind(otherId, layerId).first();
    const otherDob = other && (other as any).dob
      ? new Date((await decryptProtectedValue(env, (other as any).dob as string | null)) || '').getTime()
      : 0;
    if (!otherDob || otherDob === personDob) continue;

    const link = buildSiblingLinkMeta(personId, otherId, personDob, otherDob);

    await db.prepare(
      'UPDATE relationships SET from_person_id = ?, to_person_id = ?, metadata = ? WHERE id = ? AND layer_id = ?'
    ).bind(link.fromId, link.toId, link.metadata, relAny.id, layerId).run();
  }
}

export function registerPeopleRoutes(app: Hono<AppBindings>) {
  const MAX_AVATAR_BYTES = 20 * 1024 * 1024;
  const ALLOWED_AVATAR_TYPES: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };

  const avatarSelectSql = `
    SELECT id, person_id, avatar_url, storage_key, is_primary, sort_order, created_at, updated_at
    FROM person_avatars
  `;

  let peopleSchemaSupportPromise: Promise<{ hasEmail: boolean }> | null = null;
  const getPeopleSchemaSupport = async (db: Env['DB']) => {
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

  const normalizeAvatar = (row: any): PersonAvatar => ({
    id: String(row.id),
    person_id: String(row.person_id),
    avatar_url: String(row.avatar_url),
    storage_key: row.storage_key ? String(row.storage_key) : null,
    is_primary: Number(row.is_primary) === 1,
    sort_order: Number(row.sort_order ?? 0),
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null
  });

  const deriveStorageKeyFromUrl = (avatarUrl: string | null | undefined) => {
    if (!avatarUrl) return null;
    if (!avatarUrl.startsWith('/api/avatars/')) return null;
    return avatarUrl.replace('/api/avatars/', '');
  };

  const loadAvatarMap = async (db: Env['DB']) => {
    const { results } = await db.prepare(
      `${avatarSelectSql} ORDER BY person_id ASC, is_primary DESC, sort_order ASC, created_at ASC`
    ).all();
    const map = new Map<string, PersonAvatar[]>();
    results.forEach((row: any) => {
      const avatar = normalizeAvatar(row);
      const list = map.get(avatar.person_id) || [];
      list.push(avatar);
      map.set(avatar.person_id, list);
    });
    return map;
  };

  const loadPersonAvatars = async (db: Env['DB'], personId: string) => {
    const { results } = await db.prepare(
      `${avatarSelectSql} WHERE person_id = ? ORDER BY is_primary DESC, sort_order ASC, created_at ASC`
    ).bind(personId).all();
    return results.map((row) => normalizeAvatar(row));
  };

  const resolvePrimaryAvatar = (avatars: PersonAvatar[]) => (
    avatars.find((avatar) => avatar.is_primary) || avatars[0] || null
  );

  const syncPrimaryAvatar = async (
    db: Env['DB'],
    personId: string,
    now: string,
    preferredAvatarId?: string
  ) => {
    const avatars = await loadPersonAvatars(db, personId);
    if (avatars.length === 0) {
      await db.prepare(
        'UPDATE people SET avatar_url = ?, updated_at = ? WHERE id = ?'
      ).bind(null, now, personId).run();
      return { primary: null as PersonAvatar | null, avatars };
    }

    const preferred = preferredAvatarId
      ? avatars.find((avatar) => avatar.id === preferredAvatarId)
      : null;
    const primary = preferred || resolvePrimaryAvatar(avatars) || avatars[0];

    // Use two-step updates to avoid partial unique-index conflicts while switching primary avatar.
    await db.prepare(
      'UPDATE person_avatars SET is_primary = 0, updated_at = ? WHERE person_id = ? AND is_primary = 1'
    ).bind(now, personId).run();

    await db.prepare(
      'UPDATE person_avatars SET is_primary = 1, updated_at = ? WHERE person_id = ? AND id = ?'
    ).bind(now, personId, primary.id).run();

    const synced = await loadPersonAvatars(db, personId);
    const syncedPrimary = resolvePrimaryAvatar(synced);
    await db.prepare(
      'UPDATE people SET avatar_url = ?, updated_at = ? WHERE id = ?'
    ).bind(syncedPrimary?.avatar_url || null, now, personId).run();

    return {
      primary: syncedPrimary,
      avatars: synced
    };
  };

  const appendAvatar = async (
    db: Env['DB'],
    personId: string,
    avatarUrl: string,
    storageKey: string | null,
    options?: { now?: string; isPrimary?: boolean; sortOrder?: number }
  ) => {
    const now = options?.now || new Date().toISOString();
    const avatarId = crypto.randomUUID();
    const isPrimary = options?.isPrimary !== false;

    let sortOrder = options?.sortOrder;
    if (sortOrder === undefined) {
      const row = await db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM person_avatars WHERE person_id = ?'
      ).bind(personId).first();
      sortOrder = Number((row as any)?.max_sort ?? -1) + 1;
    }

    await db.prepare(
      `INSERT INTO person_avatars (
        id, person_id, avatar_url, storage_key, is_primary, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      avatarId,
      personId,
      avatarUrl,
      storageKey,
      0,
      sortOrder,
      now,
      now
    ).run();

    const synced = await syncPrimaryAvatar(db, personId, now, isPrimary ? avatarId : undefined);
    return {
      avatar: synced.avatars.find((item) => item.id === avatarId) || null,
      primary: synced.primary,
      avatars: synced.avatars
    };
  };

  const ensureAvatarFromLegacy = async (db: Env['DB'], person: any) => {
    const legacyUrl = person?.avatar_url as string | null | undefined;
    const personId = person?.id as string;
    let avatars = await loadPersonAvatars(db, personId);
    if (avatars.length > 0 || !legacyUrl) {
      return avatars;
    }

    const now = new Date().toISOString();
    await appendAvatar(
      db,
      personId,
      legacyUrl,
      deriveStorageKeyFromUrl(legacyUrl),
      { now, isPrimary: true, sortOrder: 0 }
    );
    avatars = await loadPersonAvatars(db, personId);
    return avatars;
  };

  const loadCustomFields = async (env: Env, layerId: string) => {
    const db = env.DB;
    const { results } = await db.prepare(
      `SELECT cf.id, cf.person_id, cf.label, cf.value
       FROM person_custom_fields cf
       INNER JOIN people p ON p.id = cf.person_id
       WHERE p.layer_id = ?`
    ).bind(layerId).all();
    await migratePlaintextCustomFieldRows(db, env, results as Array<Record<string, unknown>>);
    const decrypted = await decryptCustomFieldRows(env, results as Array<Record<string, unknown>>);
    const map = new Map<string, { label: string; value: string }[]>();
    decrypted.forEach((row: any) => {
      const list = map.get(row.person_id) || [];
      list.push({ label: row.label, value: row.value });
      map.set(row.person_id, list);
    });
    return map;
  };

  const loadPersonCustomFields = async (env: Env, personId: string) => {
    const db = env.DB;
    const { results } = await db.prepare(
      'SELECT id, label, value FROM person_custom_fields WHERE person_id = ? ORDER BY id'
    ).bind(personId).all();
    await migratePlaintextCustomFieldRows(db, env, results as Array<Record<string, unknown>>);
    const decrypted = await decryptCustomFieldRows(env, results as Array<Record<string, unknown>>);
    return decrypted.map((row: any) => ({ label: row.label, value: row.value }));
  };

  const extractCustomFields = (body: any, metadata: any) => {
    if (Array.isArray(body?.custom_fields)) return body.custom_fields;
    if (Array.isArray(metadata?.customFields)) return metadata.customFields;
    return null;
  };

  const buildPersonPayload = (
    person: any,
    customFields: { label: string; value: string }[],
    avatars: PersonAvatar[]
  ) => {
    const primaryAvatar = resolvePrimaryAvatar(avatars);
    return {
      ...person,
      layer_id: person.layer_id ?? null,
      avatar_url: primaryAvatar?.avatar_url || person.avatar_url || null,
      avatars,
      metadata: {
        ...safeParse(person.metadata as string),
        customFields
      }
    };
  };

  const normalizeEmail = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return normalized || null;
  };

  const parseBoolean = (value: unknown, fallback = false) => {
    if (value === null || value === undefined) return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return fallback;
  };

  const ensurePersonExists = async (db: Env['DB'], personId: string) => {
    const existing = await db.prepare(
      'SELECT id, layer_id, name, avatar_url FROM people WHERE id = ?'
    ).bind(personId).first();
    if (!existing) return null;
    await ensureAvatarFromLegacy(db, existing as any);
    return existing as any;
  };

  const handleAvatarUpload = async (
    c: Context<AppBindings>,
    personId: string,
    file: UploadFile,
    options?: {
      setPrimary?: boolean;
      mirrorPath?: string;
      mirrorSetPrimary?: boolean;
      notifySource?: 'legacy' | 'multi';
    }
  ) => {
    if (file.size > MAX_AVATAR_BYTES) {
      return c.json({ error: 'file is too large' }, 413);
    }

    if (!file.type || !file.type.startsWith('image/')) {
      return c.json({ error: 'unsupported file type' }, 400);
    }

    const ext = ALLOWED_AVATAR_TYPES[file.type];
    if (!ext) {
      return c.json({ error: 'unsupported file type' }, 400);
    }

    const existing = await ensurePersonExists(c.env.DB, personId);
    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }

    const now = new Date().toISOString();
    const key = `person-${personId}-${Date.now()}-${crypto.randomUUID()}.${ext}`;
    await c.env.AVATARS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type }
    });

    const avatarUrl = `/api/avatars/${key}`;
    const created = await appendAvatar(
      c.env.DB,
      personId,
      avatarUrl,
      key,
      {
        now,
        isPrimary: options?.setPrimary !== false
      }
    );

    const avatarLink = new URL(avatarUrl, c.req.url).toString();
    notifyUpdate(c, 'people:avatar', {
      id: personId,
      name: existing.name ?? null,
      avatar_url: created.primary?.avatar_url ?? avatarUrl,
      avatar_id: created.avatar?.id ?? null,
      avatar_count: created.avatars.length,
      source: options?.notifySource || 'multi'
    }, { photoUrl: avatarLink });

    await recordAuditLog(c, {
      action: 'update_avatar',
      resourceType: 'people',
      resourceId: personId,
      summary: `更新人物頭像 ${String(existing.name ?? personId)}`,
      details: {
        avatar_url: avatarUrl,
        avatar_id: created.avatar?.id ?? null,
        set_primary: options?.setPrimary !== false,
        avatar_count: created.avatars.length
      }
    });

    const avatarBuffer = await file.arrayBuffer();
    const mirrorForm = new FormData();
    mirrorForm.set('file', new Blob([avatarBuffer], { type: file.type || 'application/octet-stream' }), file.name || 'avatar');
    if (options?.mirrorSetPrimary !== undefined) {
      mirrorForm.set('set_primary', options.mirrorSetPrimary ? '1' : '0');
    }
    queueRemoteFormData(c, options?.mirrorPath || `/api/people/${personId}/avatars`, mirrorForm);

    return c.json({
      avatar: created.avatar,
      avatars: created.avatars,
      avatar_url: created.primary?.avatar_url || null
    });
  };

  // Get all people
  app.get('/api/people', async (c) => {
    const layerId = resolveLayerId(c);
    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }
    const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
    const { results } = await c.env.DB.prepare(
      `SELECT id, layer_id, name, english_name, ${peopleSchema.hasEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at
       FROM people
       WHERE layer_id = ?
       ORDER BY created_at`
    ).bind(layerId).all();
    await Promise.all((results as any[]).map((row) => migratePlaintextPersonRow(c.env.DB, c.env, row as Record<string, unknown>)));
    const customFieldsMap = await loadCustomFields(c.env, layerId);
    const avatarMap = await loadAvatarMap(c.env.DB);

    const parsedResults = await Promise.all(results.map(async (person: any) => {
      const decryptedPerson = await decryptPersonRow(c.env, person);
      const avatars = avatarMap.get(decryptedPerson.id) || await ensureAvatarFromLegacy(c.env.DB, decryptedPerson);
      return buildPersonPayload(decryptedPerson, customFieldsMap.get(decryptedPerson.id) || [], avatars);
    }));

    return c.json(parsedResults);
  });

  // Get a single person by ID
  app.get('/api/people/:id', async (c) => {
    const id = c.req.param('id');
    const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
    const person = await c.env.DB.prepare(
      `SELECT id, layer_id, name, english_name, ${peopleSchema.hasEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people WHERE id = ?`
    ).bind(id).first();

    if (!person) {
      return c.json({ error: 'Person not found' }, 404);
    }
    await migratePlaintextPersonRow(c.env.DB, c.env, person as Record<string, unknown>);
    const decryptedPerson = await decryptPersonRow(c.env, person as Record<string, unknown>);
    const customFields = await loadPersonCustomFields(c.env, id);
    const avatars = await ensureAvatarFromLegacy(c.env.DB, decryptedPerson as any);
    return c.json(buildPersonPayload(decryptedPerson, customFields, avatars));
  });

  // List avatars for a single person
  app.get('/api/people/:id/avatars', async (c) => {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      'SELECT id, avatar_url FROM people WHERE id = ?'
    ).bind(id).first();

    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }

    const avatars = await ensureAvatarFromLegacy(c.env.DB, existing as any);
    return c.json({
      person_id: id,
      avatar_url: resolvePrimaryAvatar(avatars)?.avatar_url || (existing as any).avatar_url || null,
      avatars
    });
  });

  // Create a new person
  app.post('/api/people', async (c) => {
    const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
    const body = await c.req.json();
    const layerId = resolveLayerId(c, body);
    const { id: providedId, name, english_name, email, gender, blood_type, dob, dod, tob, tod, avatar_url, metadata } = body;

    if (!name) {
      return c.json({ error: 'Name is required' }, 400);
    }
    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }

    const id = providedId || crypto.randomUUID();
    const now = new Date().toISOString();
    const normalizedEmail = normalizeEmail(email);
    const protectedFields = await protectPersonWriteFields(c.env, {
      blood_type: blood_type || null,
      dob: dob || null,
      dod: dod || null,
      tob: tob || null,
      tod: tod || null,
      metadata: metadata ? JSON.stringify(metadata) : null
    });

    const insertColumns = ['id', 'layer_id', 'name', 'english_name'];
    const insertValues: unknown[] = [id, layerId, name, english_name || null];
    if (peopleSchema.hasEmail) {
      insertColumns.push('email');
      insertValues.push(normalizedEmail);
    }
    insertColumns.push('gender', 'blood_type', 'dob', 'dod', 'tob', 'tod', 'avatar_url', 'metadata', 'created_at', 'updated_at');
    insertValues.push(
      gender || 'O',
      protectedFields.blood_type ?? null,
      protectedFields.dob ?? null,
      protectedFields.dod ?? null,
      protectedFields.tob ?? null,
      protectedFields.tod ?? null,
      avatar_url || null,
      protectedFields.metadata ?? null,
      now,
      now
    );
    await c.env.DB.prepare(
      `INSERT INTO people (${insertColumns.join(', ')}) VALUES (${insertColumns.map(() => '?').join(', ')})`
    ).bind(...insertValues).run();

    const customFields = extractCustomFields(body, metadata);
    if (customFields) {
      for (const field of customFields) {
        if (!field?.label && !field?.value) continue;
        await c.env.DB.prepare(
          'INSERT INTO person_custom_fields (person_id, label, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(
          id,
          field.label || '',
          await encryptProtectedValue(c.env, field.value || ''),
          now,
          now
        ).run();
      }
    }

    const inputAvatars = Array.isArray(body?.avatars) ? body.avatars : [];
    if (inputAvatars.length > 0) {
      const candidates = inputAvatars
        .map((entry: any, index: number) => ({
          avatar_url: typeof entry?.avatar_url === 'string' ? entry.avatar_url.trim() : '',
          is_primary: entry?.is_primary === true,
          sort_order: Number.isFinite(entry?.sort_order) ? Number(entry.sort_order) : index
        }))
        .filter((entry: any) => Boolean(entry.avatar_url));

      let primaryPicked = false;
      for (const entry of candidates) {
        const makePrimary = entry.is_primary === true || (!primaryPicked && !candidates.some((candidate: any) => candidate.is_primary === true));
        await appendAvatar(
          c.env.DB,
          id,
          entry.avatar_url,
          deriveStorageKeyFromUrl(entry.avatar_url),
          {
            now,
            isPrimary: makePrimary,
            sortOrder: entry.sort_order
          }
        );
        if (makePrimary) primaryPicked = true;
      }
    } else if (avatar_url) {
      await appendAvatar(
        c.env.DB,
        id,
        avatar_url,
        deriveStorageKeyFromUrl(avatar_url),
        { now, isPrimary: true }
      );
    }

    const person = await c.env.DB.prepare(
      `SELECT id, layer_id, name, english_name, ${peopleSchema.hasEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people WHERE id = ?`
    ).bind(id).first();

    const customFieldsResult = await loadPersonCustomFields(c.env, id);
    const decryptedPerson = person ? await decryptPersonRow(c.env, person as Record<string, unknown>) : null;
    const avatars = decryptedPerson ? await ensureAvatarFromLegacy(c.env.DB, decryptedPerson as any) : [];
    const metadataKeys = metadata && typeof metadata === 'object'
      ? Object.keys(metadata as Record<string, unknown>)
      : [];
    const customFieldsCount = Array.isArray(customFields) ? customFields.length : 0;
    const customFieldLabels = Array.isArray(customFields)
      ? customFields.map(field => String(field?.label || '')).filter(Boolean)
      : [];
    const avatarLink = avatar_url ? new URL(avatar_url, c.req.url).toString() : undefined;
    notifyUpdate(c, 'people:create', {
      id,
      layer_id: layerId,
      name,
      english_name,
      email: normalizedEmail,
      gender,
      avatar_url,
      avatars_count: avatars.length,
      metadata_keys: metadataKeys,
      custom_fields_count: customFieldsCount,
      custom_field_labels: customFieldLabels,
      has_protected_fields: Boolean(blood_type || dob || dod || tob || tod)
    }, avatarLink ? { photoUrl: avatarLink } : undefined);
    await recordAuditLog(c, {
      action: 'create',
      resourceType: 'people',
      resourceId: id,
      summary: `新增人物 ${name}`,
      details: {
        name,
        english_name: english_name || null,
        email: normalizedEmail,
        gender: gender || 'O',
        avatar_url: avatar_url || null,
        avatars_count: avatars.length,
        metadata_keys: metadataKeys,
        custom_fields_count: customFieldsCount,
        custom_field_labels: customFieldLabels,
        has_protected_fields: Boolean(blood_type || dob || dod || tob || tod)
      }
    });

    const mirrorPayload: Record<string, unknown> = {
      id,
      name,
      english_name: english_name || null,
      email: normalizedEmail,
      gender: gender || 'O',
      blood_type: blood_type || null,
      dob: dob || null,
      dod: dod || null,
      tob: tob || null,
      tod: tod || null,
      avatar_url: avatar_url || null,
      layer_id: layerId,
      avatars: avatars.map((avatar) => ({
        id: avatar.id,
        avatar_url: avatar.avatar_url,
        is_primary: avatar.is_primary,
        sort_order: avatar.sort_order
      })),
      metadata: metadata || null
    };
    if (customFields) {
      mirrorPayload.custom_fields = customFields;
    }
    queueRemoteJson(c, 'POST', '/api/people', mirrorPayload);

    return c.json(buildPersonPayload(decryptedPerson, customFieldsResult, avatars), 201);
  });

  // Update a person
  app.put('/api/people/:id', async (c) => {
    const id = c.req.param('id');
    const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
    const body = await c.req.json();
    const { name, english_name, email, gender, blood_type, dob, dod, tob, tod, avatar_url, metadata } = body;

    const existing = await c.env.DB.prepare(
      `SELECT id, layer_id, name, english_name, ${peopleSchema.hasEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata FROM people WHERE id = ?`
    ).bind(id).first();

    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }
    await migratePlaintextPersonRow(c.env.DB, c.env, existing as Record<string, unknown>);
    const existingAny = await decryptPersonRow(c.env, existing as Record<string, unknown>) as any;
    const previousDob = existingAny.dob as string | null;
    const existingCustomFields = await loadPersonCustomFields(c.env, id);
    await ensureAvatarFromLegacy(c.env.DB, existingAny);

    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: unknown[] = [];
    const changedFields: string[] = [];
    const protectedUpdates = await protectPersonWriteFields(c.env, {
      blood_type: blood_type !== undefined ? (blood_type as string | null) : undefined,
      dob: dob !== undefined ? (dob as string | null) : undefined,
      dod: dod !== undefined ? (dod as string | null) : undefined,
      tob: tob !== undefined ? (tob as string | null) : undefined,
      tod: tod !== undefined ? (tod as string | null) : undefined,
      metadata: metadata !== undefined ? (metadata ? JSON.stringify(metadata) : null) : undefined
    });

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
      changedFields.push('name');
    }
    if (english_name !== undefined) {
      updates.push('english_name = ?');
      values.push(english_name);
      changedFields.push('english_name');
    }
    if (peopleSchema.hasEmail && email !== undefined) {
      updates.push('email = ?');
      values.push(normalizeEmail(email));
      changedFields.push('email');
    }
    if (gender !== undefined) {
      updates.push('gender = ?');
      values.push(gender);
      changedFields.push('gender');
    }
    if (blood_type !== undefined) {
      updates.push('blood_type = ?');
      values.push(protectedUpdates.blood_type ?? null);
      changedFields.push('blood_type');
    }
    if (dob !== undefined) {
      updates.push('dob = ?');
      values.push(protectedUpdates.dob ?? null);
      changedFields.push('dob');
    }
    if (dod !== undefined) {
      updates.push('dod = ?');
      values.push(protectedUpdates.dod ?? null);
      changedFields.push('dod');
    }
    if (tob !== undefined) {
      updates.push('tob = ?');
      values.push(protectedUpdates.tob ?? null);
      changedFields.push('tob');
    }
    if (tod !== undefined) {
      updates.push('tod = ?');
      values.push(protectedUpdates.tod ?? null);
      changedFields.push('tod');
    }
    if (avatar_url !== undefined) {
      updates.push('avatar_url = ?');
      values.push(avatar_url);
      changedFields.push('avatar_url');
    }
    if (metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(protectedUpdates.metadata ?? null);
      changedFields.push('metadata');
    }

    const customFields = extractCustomFields(body, metadata);

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(id);

      await c.env.DB.prepare(
        `UPDATE people SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...values).run();
    } else if (customFields !== null) {
      await c.env.DB.prepare(
        'UPDATE people SET updated_at = ? WHERE id = ?'
      ).bind(now, id).run();
    } else {
      return c.json({ error: 'No fields to update' }, 400);
    }

    if (customFields !== null) {
      await c.env.DB.prepare(
        'DELETE FROM person_custom_fields WHERE person_id = ?'
      ).bind(id).run();
      for (const field of customFields) {
        if (!field?.label && !field?.value) continue;
        await c.env.DB.prepare(
          'INSERT INTO person_custom_fields (person_id, label, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(
          id,
          field.label || '',
          await encryptProtectedValue(c.env, field.value || ''),
          now,
          now
        ).run();
      }
    }

    if (avatar_url !== undefined) {
      if (!avatar_url) {
        await c.env.DB.prepare(
          'UPDATE person_avatars SET is_primary = 0, updated_at = ? WHERE person_id = ? AND is_primary = 1'
        ).bind(now, id).run();
        await c.env.DB.prepare(
          'UPDATE people SET avatar_url = ?, updated_at = ? WHERE id = ?'
        ).bind(null, now, id).run();
      } else {
        const existingAvatar = await c.env.DB.prepare(
          'SELECT id FROM person_avatars WHERE person_id = ? AND avatar_url = ? LIMIT 1'
        ).bind(id, avatar_url).first();
        if (existingAvatar) {
          await syncPrimaryAvatar(c.env.DB, id, now, (existingAvatar as any).id as string);
        } else {
          await appendAvatar(
            c.env.DB,
            id,
            avatar_url,
            deriveStorageKeyFromUrl(avatar_url),
            { now, isPrimary: true }
          );
        }
      }
    }

    if (dob !== undefined && dob !== previousDob) {
      await updateSiblingOrdering(c.env, id, String(existingAny.layer_id || 'default'));
    }

    const person = await c.env.DB.prepare(
      `SELECT id, layer_id, name, english_name, ${peopleSchema.hasEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people WHERE id = ?`
    ).bind(id).first();

    const customFieldsResult = await loadPersonCustomFields(c.env, id);
    const decryptedPerson = person ? await decryptPersonRow(c.env, person as Record<string, unknown>) : null;
    const avatars = decryptedPerson ? await ensureAvatarFromLegacy(c.env.DB, decryptedPerson as any) : [];
    const formatCustomFields = (fields: { label: string; value: string }[]) => (
      fields.map((field) => ({
        label: field.label || '',
        value: field.value || ''
      }))
    );

    const personName = name !== undefined ? name : (existingAny.name ?? null);
    const updateDetails: Record<string, unknown> = {
      id,
      person_name: personName,
      changed: changedFields
    };
    if (name !== undefined) {
      updateDetails.name = {
        old: existingAny.name ?? null,
        new: name
      };
    }
    if (english_name !== undefined) {
      updateDetails.english_name = {
        old: existingAny.english_name ?? null,
        new: english_name
      };
    }
    if (peopleSchema.hasEmail && email !== undefined) {
      updateDetails.email = {
        old: existingAny.email ?? null,
        new: normalizeEmail(email)
      };
    }
    if (gender !== undefined) updateDetails.gender = gender;
    if (blood_type !== undefined) updateDetails.blood_type_updated = true;
    if (dob !== undefined) updateDetails.dob_updated = true;
    if (dod !== undefined) updateDetails.dod_updated = true;
    if (tob !== undefined) updateDetails.tob_updated = true;
    if (tod !== undefined) updateDetails.tod_updated = true;
    let avatarLink: string | undefined;
    if (avatar_url !== undefined) {
      const prevAvatar = existingAny.avatar_url ?? null;
      const currentPrimary = resolvePrimaryAvatar(avatars)?.avatar_url || null;
      updateDetails.avatar_url = {
        old: prevAvatar,
        new: currentPrimary
      };
      if (currentPrimary) {
        avatarLink = new URL(currentPrimary, c.req.url).toString();
      }
    }
    if (metadata !== undefined && typeof metadata === 'object') {
      updateDetails.metadata_keys = Object.keys(metadata as Record<string, unknown>);
    }
    if (customFields !== null) {
      const nextFields = Array.isArray(customFields) ? customFields : [];
      const previousFields = formatCustomFields(existingCustomFields);
      const formattedNext = formatCustomFields(nextFields);
      if (JSON.stringify(previousFields) !== JSON.stringify(formattedNext)) {
        updateDetails.custom_fields = {
          old_labels: previousFields.map((field) => field.label),
          new_labels: formattedNext.map((field) => field.label)
        };
        updateDetails.custom_fields_count = formattedNext.length;
      }
    }
    notifyUpdate(c, 'people:update', updateDetails, avatarLink ? { photoUrl: avatarLink } : undefined);
    await recordAuditLog(c, {
      action: 'update',
      resourceType: 'people',
      resourceId: id,
      summary: `更新人物 ${String(personName || id)}`,
      details: {
        changed_fields: changedFields,
        name: personName,
        custom_fields_updated: customFields !== null
      }
    });
    queueRemoteJson(c, 'PUT', `/api/people/${id}`, body);
    return c.json(buildPersonPayload(decryptedPerson, customFieldsResult, avatars));
  });

  // Upload avatar for a person (multi-avatar API)
  app.post('/api/people/:id/avatars', async (c) => {
    try {
      const id = c.req.param('id');
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!isUploadFile(file)) {
        return c.json({ error: 'file is required' }, 400);
      }
      const setPrimary = parseBoolean(formData.get('set_primary'), true);
      return handleAvatarUpload(c, id, file, {
        setPrimary,
        mirrorPath: `/api/people/${id}/avatars`,
        mirrorSetPrimary: setPrimary,
        notifySource: 'multi'
      });
    } catch (error) {
      console.error('Avatar upload failed:', error);
      return c.json({ error: 'Avatar upload failed' }, 500);
    }
  });

  // Backward-compatible single-avatar endpoint
  app.post('/api/people/:id/avatar', async (c) => {
    try {
      const id = c.req.param('id');
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!isUploadFile(file)) {
        return c.json({ error: 'file is required' }, 400);
      }
      return handleAvatarUpload(c, id, file, {
        setPrimary: true,
        mirrorPath: `/api/people/${id}/avatar`,
        notifySource: 'legacy'
      });
    } catch (error) {
      console.error('Avatar upload failed:', error);
      return c.json({ error: 'Avatar upload failed' }, 500);
    }
  });

  // Update avatar metadata (set primary / reorder)
  app.put('/api/people/:id/avatars/:avatarId', async (c) => {
    const id = c.req.param('id');
    const avatarId = c.req.param('avatarId');
    const body = await c.req.json();
    const now = new Date().toISOString();

    const existing = await ensurePersonExists(c.env.DB, id);
    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }

    const avatar = await c.env.DB.prepare(
      'SELECT id, person_id FROM person_avatars WHERE id = ? AND person_id = ?'
    ).bind(avatarId, id).first();

    if (!avatar) {
      return c.json({ error: 'Avatar not found' }, 404);
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    const wantsPrimary = body?.is_primary === true;
    if (Number.isFinite(body?.sort_order)) {
      updates.push('sort_order = ?');
      values.push(Number(body.sort_order));
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(avatarId);
      values.push(id);
      await c.env.DB.prepare(
        `UPDATE person_avatars SET ${updates.join(', ')} WHERE id = ? AND person_id = ?`
      ).bind(...values).run();
    }

    const synced = await syncPrimaryAvatar(c.env.DB, id, now, wantsPrimary ? avatarId : undefined);

    await recordAuditLog(c, {
      action: 'update_avatar',
      resourceType: 'people',
      resourceId: id,
      summary: `更新人物頭像設定 ${String(existing.name ?? id)}`,
      details: {
        avatar_id: avatarId,
        is_primary: wantsPrimary,
        sort_order: Number.isFinite(body?.sort_order) ? Number(body.sort_order) : undefined
      }
    });

    queueRemoteJson(c, 'PUT', `/api/people/${id}/avatars/${avatarId}`, body);

    return c.json({
      avatar: synced.avatars.find((item) => item.id === avatarId) || null,
      avatars: synced.avatars,
      avatar_url: synced.primary?.avatar_url || null
    });
  });

  // Delete one avatar for a person
  app.delete('/api/people/:id/avatars/:avatarId', async (c) => {
    const id = c.req.param('id');
    const avatarId = c.req.param('avatarId');
    const now = new Date().toISOString();

    const existing = await ensurePersonExists(c.env.DB, id);
    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }

    const avatar = await c.env.DB.prepare(
      `${avatarSelectSql} WHERE id = ? AND person_id = ? LIMIT 1`
    ).bind(avatarId, id).first();

    if (!avatar) {
      return c.json({ error: 'Avatar not found' }, 404);
    }

    const normalized = normalizeAvatar(avatar);
    await c.env.DB.prepare(
      'DELETE FROM person_avatars WHERE id = ? AND person_id = ?'
    ).bind(avatarId, id).run();

    const key = normalized.storage_key || deriveStorageKeyFromUrl(normalized.avatar_url);
    if (key) {
      await c.env.AVATARS.delete(key);
    }

    const synced = await syncPrimaryAvatar(c.env.DB, id, now);
    await recordAuditLog(c, {
      action: 'update_avatar',
      resourceType: 'people',
      resourceId: id,
      summary: `刪除人物頭像 ${String(existing.name ?? id)}`,
      details: {
        avatar_id: avatarId,
        avatar_url: normalized.avatar_url,
        deleted_storage_key: key || null,
        remaining_count: synced.avatars.length
      }
    });

    queueRemoteJson(c, 'DELETE', `/api/people/${id}/avatars/${avatarId}`, undefined);

    return c.json({
      success: true,
      avatar_id: avatarId,
      avatars: synced.avatars,
      avatar_url: synced.primary?.avatar_url || null
    });
  });

  // Serve avatar images from R2
  app.get('/api/avatars/:key', async (c) => {
    const key = c.req.param('key');
    const object = await c.env.AVATARS.get(key);
    if (!object) {
      return c.json({ error: 'Avatar not found' }, 404);
    }
    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    const origin = c.req.header('Origin') || '';
    const allowedOrigins = (c.env.FRONTEND_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean);
    const allowOrigin = origin && allowedOrigins.includes(origin)
      ? origin
      : (allowedOrigins[0] || '');
    if (allowOrigin) {
      headers.set('Access-Control-Allow-Origin', allowOrigin);
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Vary', 'Origin');
    }
    return new Response(object.body, { headers });
  });

  // Delete a person
  app.delete('/api/people/:id', async (c) => {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      'SELECT id, name, english_name FROM people WHERE id = ?'
    ).bind(id).first();

    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }

    const avatarRows = await loadPersonAvatars(c.env.DB, id);
    for (const avatar of avatarRows) {
      const key = avatar.storage_key || deriveStorageKeyFromUrl(avatar.avatar_url);
      if (!key) continue;
      await c.env.AVATARS.delete(key);
    }

    await c.env.DB.prepare(
      'DELETE FROM person_custom_fields WHERE person_id = ?'
    ).bind(id).run();

    const result = await c.env.DB.prepare(
      'DELETE FROM people WHERE id = ?'
    ).bind(id).run();

    if (result.success && (result.meta.changes ?? 0) > 0) {
      notifyUpdate(c, 'people:delete', {
        id,
        name: (existing as any).name ?? null,
        english_name: (existing as any).english_name ?? null
      });
      await recordAuditLog(c, {
        action: 'delete',
        resourceType: 'people',
        resourceId: id,
        summary: `刪除人物 ${(existing as any).name ?? id}`,
        details: {
          name: (existing as any).name ?? null,
          english_name: (existing as any).english_name ?? null,
          removed_avatar_count: avatarRows.length
        }
      });
      queueRemoteJson(c, 'DELETE', `/api/people/${id}`, undefined);
      return c.json({ success: true, id });
    }
    return c.json({ error: 'Person not found' }, 404);
  });
}
