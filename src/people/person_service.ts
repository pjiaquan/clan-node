import type { Env } from '../types';
import type { PeopleRepository } from '../repositories';
import { safeParseObject } from '../utils';
import { buildSiblingLinkMeta } from '../relationship_utils';
import {
  decryptCustomFieldRows,
  decryptPersonRow,
  decryptProtectedValue,
  migratePlaintextCustomFieldRows,
} from '../data_protection';
import { getUserSchemaSupport } from '../schema';
import type { PersonAvatar } from './avatar_service';

export const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

export const parseBoolean = (value: unknown, fallback = false) => {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

export const extractCustomFields = (body: Record<string, unknown>, metadata: unknown) => {
  if (Array.isArray(body.custom_fields)) return body.custom_fields;
  if (metadata && typeof metadata === 'object' && Array.isArray((metadata as { customFields?: unknown[] }).customFields)) {
    return (metadata as { customFields: unknown[] }).customFields;
  }
  return null;
};

export const buildPersonUpdatePayload = (
  input: {
    name?: unknown;
    english_name?: unknown;
    normalizedEmail?: string | null;
    includeEmail?: boolean;
    gender?: unknown;
    avatar_url?: unknown;
    metadataProtected?: string | null | undefined;
    protectedUpdates: {
      blood_type?: string | null;
      dob?: string | null;
      dod?: string | null;
      tob?: string | null;
      tod?: string | null;
    };
    now: string;
  },
) => {
  const updatePayload: Record<string, unknown> = {};
  const changedFields: string[] = [];
  if (input.name !== undefined) {
    updatePayload.name = input.name;
    changedFields.push('name');
  }
  if (input.english_name !== undefined) {
    updatePayload.english_name = input.english_name;
    changedFields.push('english_name');
  }
  if (input.includeEmail && input.normalizedEmail !== undefined) {
    updatePayload.email = input.normalizedEmail;
    changedFields.push('email');
  }
  if (input.gender !== undefined) {
    updatePayload.gender = input.gender;
    changedFields.push('gender');
  }
  if (input.protectedUpdates.blood_type !== undefined) {
    updatePayload.blood_type = input.protectedUpdates.blood_type ?? null;
    changedFields.push('blood_type');
  }
  if (input.protectedUpdates.dob !== undefined) {
    updatePayload.dob = input.protectedUpdates.dob ?? null;
    changedFields.push('dob');
  }
  if (input.protectedUpdates.dod !== undefined) {
    updatePayload.dod = input.protectedUpdates.dod ?? null;
    changedFields.push('dod');
  }
  if (input.protectedUpdates.tob !== undefined) {
    updatePayload.tob = input.protectedUpdates.tob ?? null;
    changedFields.push('tob');
  }
  if (input.protectedUpdates.tod !== undefined) {
    updatePayload.tod = input.protectedUpdates.tod ?? null;
    changedFields.push('tod');
  }
  if (input.avatar_url !== undefined) {
    updatePayload.avatar_url = input.avatar_url;
    changedFields.push('avatar_url');
  }
  if (input.metadataProtected !== undefined) {
    updatePayload.metadata = input.metadataProtected ?? null;
    changedFields.push('metadata');
  }
  if (changedFields.length > 0) {
    updatePayload.updated_at = input.now;
  }
  return { updatePayload, changedFields };
};

export const buildPersonPayload = (
  person: Record<string, unknown>,
  customFields: { label: string; value: string }[],
  avatars: PersonAvatar[],
  resolvePrimaryAvatar: (avatars: PersonAvatar[]) => PersonAvatar | null,
  emailVerifiedAt: string | null = null,
) => {
  const primaryAvatar = resolvePrimaryAvatar(avatars);
  return {
    ...person,
    layer_id: person.layer_id ?? null,
    email_verified_at: emailVerifiedAt,
    avatar_url: primaryAvatar?.avatar_url || person.avatar_url || null,
    avatars,
    metadata: {
      ...(safeParseObject(person.metadata as string | null | undefined) ?? {}),
      customFields,
    },
  };
};

export const lookupVerifiedEmailAtFromRepository = async (
  db: Env['DB'],
  repository: PeopleRepository,
  email: string | null | undefined,
) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const userSchema = await getUserSchemaSupport(db);
  if (!userSchema.hasEmail || !userSchema.hasEmailVerifiedAt) return null;
  return repository.findVerifiedEmailAt(normalizedEmail);
};

export const loadCustomFields = async (env: Env, repository: PeopleRepository, layerId: string) => {
  const results = await repository.listCustomFieldRowsByLayer(layerId);
  await migratePlaintextCustomFieldRows(env.DB, env, results);
  const decrypted = await decryptCustomFieldRows(env, results);
  const map = new Map<string, { label: string; value: string }[]>();
  decrypted.forEach((row: Record<string, unknown>) => {
    const personId = String(row.person_id);
    const list = map.get(personId) || [];
    list.push({ label: String(row.label ?? ''), value: String(row.value ?? '') });
    map.set(personId, list);
  });
  return map;
};

export const loadPersonCustomFields = async (env: Env, repository: PeopleRepository, personId: string) => {
  const results = await repository.listCustomFieldRowsByPersonId(personId);
  await migratePlaintextCustomFieldRows(env.DB, env, results);
  const decrypted = await decryptCustomFieldRows(env, results);
  return decrypted.map((row: Record<string, unknown>) => ({
    label: String(row.label ?? ''),
    value: String(row.value ?? ''),
  }));
};

export async function updateSiblingOrdering(env: Env, repository: PeopleRepository, personId: string, layerId: string) {
  const person = await repository.getPersonByIdInLayer(personId, layerId);

  const personDob = person && person.dob
    ? new Date((await decryptProtectedValue(env, person.dob as string | null)) || '').getTime()
    : 0;
  if (!personDob) return;

  const results = await repository.listSiblingEdges(layerId, personId);

  for (const rel of results) {
    const otherId = rel.from_person_id === personId ? String(rel.to_person_id) : String(rel.from_person_id);
    const other = await repository.getPersonByIdInLayer(otherId, layerId);
    const otherDob = other && other.dob
      ? new Date((await decryptProtectedValue(env, other.dob as string | null)) || '').getTime()
      : 0;
    if (!otherDob || otherDob === personDob) continue;

    const link = buildSiblingLinkMeta(personId, otherId, personDob, otherDob);

    await env.DB.prepare(
      'UPDATE relationships SET from_person_id = ?, to_person_id = ?, metadata = ? WHERE id = ? AND layer_id = ?'
    ).bind(link.fromId, link.toId, link.metadata, rel.id, layerId).run();
  }
}

export const ensurePersonExists = async (
  repository: PeopleRepository,
  db: Env['DB'],
  personId: string,
  layerId: string,
  ensureAvatarFromLegacy: (db: Env['DB'], person: { id: string; avatar_url?: string | null }) => Promise<PersonAvatar[]>,
) => {
  const existing = await repository.getPersonSummaryByIdInLayer(personId, layerId);
  if (!existing) return null;
  await ensureAvatarFromLegacy(db, existing as { id: string; avatar_url?: string | null });
  return existing as Record<string, unknown>;
};

export const decryptPersonForResponse = async (env: Env, row: Record<string, unknown>) => (
  decryptPersonRow(env, row)
);
