import { DEFAULT_LAYER_ID, DEFAULT_LAYER_NAME } from '../layers';
import type { Gender, RelationshipType } from '../types';

export const BACKUP_VERSION = 2;
export const IMPORT_CONFIRMATION_TEXT = 'DELETE';

export type BackupLayer = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type BackupPerson = {
  id: string;
  layer_id: string;
  name: string;
  english_name: string | null;
  email: string | null;
  gender: Gender;
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

export type BackupAvatar = {
  id: string;
  person_id: string;
  avatar_url: string;
  storage_key: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type BackupRelationship = {
  id: number | null;
  layer_id: string;
  from_person_id: string;
  to_person_id: string;
  type: RelationshipType;
  metadata: string | null;
  created_at: string;
};

export type BackupCustomField = {
  id: number | null;
  person_id: string;
  label: string;
  value: string;
  created_at: string;
  updated_at: string;
};

export type BackupRelationshipTypeLabel = {
  type: RelationshipType;
  label: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type BackupKinshipLabel = {
  default_title: string;
  default_formal_title: string;
  custom_title: string | null;
  custom_formal_title: string | null;
  description: string;
  created_at: string;
  updated_at: string;
};

export const RELATIONSHIP_TYPES = new Set<RelationshipType>(['parent_child', 'spouse', 'ex_spouse', 'sibling', 'in_law']);
export const GENDERS = new Set<Gender>(['M', 'F', 'O']);

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

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

export const requireArrayField = (source: Record<string, unknown>, field: string) => {
  const value = source[field];
  if (!Array.isArray(value)) {
    throw new Error(`Field "${field}" must be an array`);
  }
  return value;
};

export const extractDataEnvelope = (body: unknown) => {
  if (!isRecord(body)) {
    throw new Error('Invalid backup payload');
  }
  if (isRecord(body.data)) {
    return body.data;
  }
  return body;
};

export const parseLayers = (input: unknown[], now: string): BackupLayer[] => {
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

export const parsePeople = (input: unknown[], now: string): BackupPerson[] => {
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
    if (!GENDERS.has(gender as Gender)) {
      throw new Error(`Invalid gender for person "${id}"`);
    }
    return {
      id,
      layer_id: typeof row.layer_id === 'string' && row.layer_id.trim() ? row.layer_id.trim() : DEFAULT_LAYER_ID,
      name,
      english_name: asNullableString(row.english_name),
      email: asNullableString(row.email),
      gender: gender as Gender,
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

export const parseAvatars = (input: unknown[], now: string): BackupAvatar[] => (
  input.map((row, index) => {
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
  })
);

export const parseRelationships = (input: unknown[], now: string): BackupRelationship[] => (
  input.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Invalid relationships[${index}]`);
    const type = asString(row.type, `relationships[${index}].type`) as RelationshipType;
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
  })
);

export const parseCustomFields = (input: unknown[], now: string): BackupCustomField[] => (
  input.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Invalid person_custom_fields[${index}]`);
    return {
      id: asNullableNumber(row.id),
      person_id: asString(row.person_id, `person_custom_fields[${index}].person_id`),
      label: asString(row.label, `person_custom_fields[${index}].label`),
      value: asString(row.value, `person_custom_fields[${index}].value`),
      created_at: asOptionalTimestamp(row.created_at, now),
      updated_at: asOptionalTimestamp(row.updated_at, now),
    };
  })
);

export const parseRelationshipTypeLabels = (input: unknown[], now: string): BackupRelationshipTypeLabel[] => (
  input.map((row, index) => {
    if (!isRecord(row)) throw new Error(`Invalid relationship_type_labels[${index}]`);
    const type = asString(row.type, `relationship_type_labels[${index}].type`) as RelationshipType;
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
  })
);

export const parseKinshipLabels = (input: unknown[], now: string): BackupKinshipLabel[] => (
  input.map((row, index) => {
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
  })
);

export const validateRelations = (
  layers: BackupLayer[],
  people: BackupPerson[],
  avatars: BackupAvatar[],
  relationships: BackupRelationship[],
  customFields: BackupCustomField[],
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

export const buildLegacyDefaultLayer = (now: string): BackupLayer => ({
  id: DEFAULT_LAYER_ID,
  name: DEFAULT_LAYER_NAME,
  description: 'Legacy backup default layer',
  created_at: now,
  updated_at: now,
});

export const buildExportPayload = (
  sessionUsername: string | null,
  layers: Array<Record<string, unknown>>,
  people: Array<Record<string, unknown>>,
  avatars: Array<Record<string, unknown>>,
  relationships: Array<Record<string, unknown>>,
  customFields: Array<Record<string, unknown>>,
  relationTypeLabels: Array<Record<string, unknown>>,
  kinshipLabels: Array<Record<string, unknown>>,
) => ({
  version: BACKUP_VERSION,
  exported_at: new Date().toISOString(),
  exported_by: sessionUsername,
  layers: layers.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    description: row.description === null ? null : String(row.description),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  })),
  people: people.map((row) => ({
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
  person_avatars: avatars.map((row) => ({
    id: String(row.id),
    person_id: String(row.person_id),
    avatar_url: String(row.avatar_url),
    storage_key: row.storage_key === null ? null : String(row.storage_key),
    is_primary: Number(row.is_primary) === 1,
    sort_order: Number(row.sort_order ?? 0),
    created_at: row.created_at === null ? null : String(row.created_at),
    updated_at: row.updated_at === null ? null : String(row.updated_at),
  })),
  relationships: relationships.map((row) => ({
    id: Number(row.id),
    layer_id: String(row.layer_id ?? DEFAULT_LAYER_ID),
    from_person_id: String(row.from_person_id),
    to_person_id: String(row.to_person_id),
    type: String(row.type),
    metadata: row.metadata === null ? null : String(row.metadata),
    created_at: String(row.created_at),
  })),
  person_custom_fields: customFields.map((row) => ({
    id: Number(row.id),
    person_id: String(row.person_id),
    label: String(row.label),
    value: String(row.value),
    created_at: row.created_at === null ? null : String(row.created_at),
    updated_at: row.updated_at === null ? null : String(row.updated_at),
  })),
  relationship_type_labels: relationTypeLabels.map((row) => ({
    type: String(row.type),
    label: String(row.label),
    description: String(row.description ?? ''),
    created_at: row.created_at === null ? null : String(row.created_at),
    updated_at: row.updated_at === null ? null : String(row.updated_at),
  })),
  kinship_labels: kinshipLabels.map((row) => ({
    default_title: String(row.default_title),
    default_formal_title: String(row.default_formal_title),
    custom_title: row.custom_title === null ? null : String(row.custom_title),
    custom_formal_title: row.custom_formal_title === null ? null : String(row.custom_formal_title),
    description: String(row.description ?? ''),
    created_at: row.created_at === null ? null : String(row.created_at),
    updated_at: row.updated_at === null ? null : String(row.updated_at),
  })),
});
