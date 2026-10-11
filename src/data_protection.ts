import { isProductionEnv } from './environment';
import type { Env } from './types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Stored ciphertext formats.
 *
 * v1 bound nothing as AAD, so a value decrypted the same way wherever it was
 * stored: anyone able to write the database could move one person's `dob` onto
 * another, swap two columns, or paste in a `users.mfa_totp_secret` (auth.ts
 * shares the key and the v1 format) and have the API decrypt it for them. v2
 * binds the table, column and owning row as AAD, so a value only decrypts
 * where it was written.
 *
 * v1 stays readable while existing rows are re-encrypted as they are read.
 * Until `DATA_PROTECTION_REJECT_LEGACY` is set, a v1 value planted anywhere
 * still decrypts, so the binding only fully holds once that flag is on.
 */
export const LEGACY_ENCRYPTED_VALUE_PREFIX = 'enc:v1';
export const ENCRYPTED_VALUE_PREFIX = 'enc:v2';
const AAD_DOMAIN = 'clan-node:data-protection';

const PERSON_PROTECTED_FIELDS = ['blood_type', 'dob', 'dod', 'tob', 'tod', 'metadata'] as const;
export type PersonProtectedField = typeof PERSON_PROTECTED_FIELDS[number];

/** Where a protected value lives; bound into the ciphertext as AAD. */
export type ProtectedValueContext =
  | { table: 'people'; column: PersonProtectedField; personId: string }
  | { table: 'person_custom_fields'; column: 'value'; personId: string; label: string };

export const personFieldContext = (personId: string, column: PersonProtectedField): ProtectedValueContext => (
  { table: 'people', column, personId }
);

/**
 * Custom fields are bound to their owner and label rather than their row id:
 * the id is only assigned on INSERT, after the value has been encrypted, and
 * every edit deletes and re-inserts the person's fields anyway.
 */
export const customFieldContext = (personId: string, label: string): ProtectedValueContext => (
  { table: 'person_custom_fields', column: 'value', personId, label }
);

/** JSON keeps the encoding unambiguous: ids and labels are user-supplied and may contain any delimiter. */
const contextAad = (context: ProtectedValueContext) => textEncoder.encode(JSON.stringify(
  context.table === 'people'
    ? [AAD_DOMAIN, ENCRYPTED_VALUE_PREFIX, context.table, context.column, context.personId]
    : [AAD_DOMAIN, ENCRYPTED_VALUE_PREFIX, context.table, context.column, context.personId, context.label]
));

export const legacyEncryptionRejected = (env: Env) => (
  ['1', 'true', 'yes'].includes((env.DATA_PROTECTION_REJECT_LEGACY || '').trim().toLowerCase())
);
const toBufferSource = (value: Uint8Array): ArrayBuffer =>
  Uint8Array.from(value).buffer;

let cachedEncryptionKeySource: string | null = null;
let cachedEncryptionKey: CryptoKey | null = null;
let encryptionKeyWarningShown = false;

const toBase64Url = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64 = (value: string) => {
  const normalized = value.replace(/\s+/g, '');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const fromBase64Url = (value: string) => fromBase64(value.replace(/-/g, '+').replace(/_/g, '/'));

const parseEncryptionKeyBytes = (value: string): Uint8Array => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('AUTH_ENCRYPTION_KEY is empty');
  }

  try {
    const decoded = fromBase64Url(trimmed);
    if (decoded.byteLength === 32) {
      return decoded;
    }
  } catch {
    // Fall through to raw-key handling.
  }

  const raw = textEncoder.encode(trimmed);
  if (raw.byteLength === 32) {
    return raw;
  }

  throw new Error('AUTH_ENCRYPTION_KEY must be 32 raw bytes/chars or a base64/base64url-encoded 32-byte key');
};

export const hasConfiguredEncryptionKey = (env: Env) => Boolean(env.AUTH_ENCRYPTION_KEY?.trim());

const getEncryptionKey = async (env: Env): Promise<CryptoKey | null> => {
  const keySource = env.AUTH_ENCRYPTION_KEY?.trim() || '';
  if (!keySource) {
    if (isProductionEnv(env)) {
      throw new Error('AUTH_ENCRYPTION_KEY must be set in production to protect sensitive data.');
    }
    if (!encryptionKeyWarningShown) {
      encryptionKeyWarningShown = true;
      console.warn('AUTH_ENCRYPTION_KEY is not set; protected fields will remain stored in plaintext.');
    }
    return null;
  }
  if (cachedEncryptionKey && cachedEncryptionKeySource === keySource) {
    return cachedEncryptionKey;
  }
  const keyBytes = parseEncryptionKeyBytes(keySource);
  cachedEncryptionKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(keyBytes),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  cachedEncryptionKeySource = keySource;
  return cachedEncryptionKey;
};

export const isLegacyEncryptedValue = (value: string | null | undefined) => (
  Boolean(value && value.startsWith(`${LEGACY_ENCRYPTED_VALUE_PREFIX}:`))
);

export const isEncryptedValue = (value: string | null | undefined) => (
  Boolean(value && (value.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`) || isLegacyEncryptedValue(value)))
);

export const encryptProtectedValue = async (
  env: Env,
  plaintext: string | null | undefined,
  context: ProtectedValueContext
): Promise<string | null> => {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext ?? null;
  const key = await getEncryptionKey(env);
  if (!key) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: contextAad(context) },
    key,
    textEncoder.encode(plaintext)
  );
  return `${ENCRYPTED_VALUE_PREFIX}:${toBase64Url(iv)}:${toBase64Url(cipher)}`;
};

export const decryptProtectedValue = async (
  env: Env,
  value: string | null | undefined,
  context: ProtectedValueContext
): Promise<string | null> => {
  if (value === null || value === undefined || value === '') return value ?? null;
  if (!isEncryptedValue(value)) {
    return value;
  }
  const parts = value.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted value payload');
  }
  const legacy = isLegacyEncryptedValue(value);
  if (legacy && legacyEncryptionRejected(env)) {
    throw new Error('Legacy enc:v1 protected values are no longer accepted');
  }
  const key = await getEncryptionKey(env);
  if (!key) {
    throw new Error('AUTH_ENCRYPTION_KEY is required to decrypt protected values');
  }
  const iv = fromBase64Url(parts[2]);
  const cipher = fromBase64Url(parts[3]);
  const plaintext = await crypto.subtle.decrypt(
    legacy ? { name: 'AES-GCM', iv } : { name: 'AES-GCM', iv, additionalData: contextAad(context) },
    key,
    cipher
  );
  return textDecoder.decode(plaintext);
};

/** Plaintext (written while no key was set) and v1 values are both rewritten as v2. */
const needsReencryption = (env: Env, value: unknown): value is string => {
  if (typeof value !== 'string' || !value) return false;
  if (!isEncryptedValue(value)) return true;
  // Once v1 is rejected, re-encrypting one would launder a planted value into a bound one.
  return isLegacyEncryptedValue(value) && !legacyEncryptionRejected(env);
};

const reencryptProtectedValue = async (env: Env, stored: string, context: ProtectedValueContext) => (
  encryptProtectedValue(env, await decryptProtectedValue(env, stored, context), context)
);

export const protectPersonWriteFields = async (
  env: Env,
  personId: string,
  fields: Partial<Record<PersonProtectedField, string | null | undefined>>
) => {
  const next: Partial<Record<PersonProtectedField, string | null>> = {};
  for (const field of PERSON_PROTECTED_FIELDS) {
    // `undefined` means "not part of this write". Callers pass every key, so
    // testing `field in fields` turned an omitted field into NULL: a name-only
    // edit, or a node drag saving metadata, erased dob, blood type and the rest.
    if (fields[field] !== undefined) {
      next[field] = await encryptProtectedValue(env, fields[field], personFieldContext(personId, field));
    }
  }
  return next;
};

export const decryptPersonField = (
  env: Env,
  personId: string,
  field: PersonProtectedField,
  value: string | null | undefined
) => decryptProtectedValue(env, value, personFieldContext(personId, field));

export const decryptPersonRow = async <T extends Record<string, unknown>>(env: Env, row: T): Promise<T> => {
  const next = { ...row } as Record<string, unknown>;
  const personId = String(next.id ?? '');
  await Promise.all(
    PERSON_PROTECTED_FIELDS.map(async (field) => {
      if (field in next) {
        next[field] = await decryptPersonField(env, personId, field, (next[field] as string | null | undefined) ?? null);
      }
    })
  );
  return next as T;
};

/**
 * The UPDATE only applies while every rewritten column still holds the value
 * that was read, so a concurrent edit is never overwritten with stale data; a
 * row that loses the race is simply migrated on a later read. `updated_at` is
 * left alone: re-encryption is not an edit, and merge_d1_via_api.mjs resolves
 * conflicts by it.
 */
export const migratePlaintextPersonRow = async (
  db: D1Database,
  env: Env,
  row: Record<string, unknown>
) => {
  if (!hasConfiguredEncryptionKey(env) || typeof row.id !== 'string') return;
  const updates: string[] = [];
  const values: string[] = [];
  const guards: string[] = [];
  const guardValues: string[] = [];
  for (const field of PERSON_PROTECTED_FIELDS) {
    const rawValue = row[field];
    if (!needsReencryption(env, rawValue)) continue;
    const encrypted = await reencryptProtectedValue(env, rawValue, personFieldContext(row.id, field));
    if (!encrypted || encrypted === rawValue) continue;
    updates.push(`${field} = ?`);
    values.push(encrypted);
    guards.push(`${field} = ?`);
    guardValues.push(rawValue);
  }
  if (!updates.length) return;
  await db.prepare(
    `UPDATE people SET ${updates.join(', ')} WHERE id = ? AND ${guards.join(' AND ')}`
  ).bind(...values, row.id, ...guardValues).run();
};

const customFieldRowContext = (row: Record<string, unknown>) => (
  customFieldContext(String(row.person_id ?? ''), String(row.label ?? ''))
);

export const decryptCustomFieldRows = async <T extends Record<string, unknown>>(env: Env, rows: T[]): Promise<T[]> => (
  Promise.all(rows.map(async (row) => ({
    ...row,
    value: await decryptProtectedValue(env, (row.value as string | null | undefined) ?? null, customFieldRowContext(row))
  } as T)))
);

/** Compare-and-swap on `value`, for the same reasons as `migratePlaintextPersonRow`. */
export const migratePlaintextCustomFieldRows = async (
  db: D1Database,
  env: Env,
  rows: Array<Record<string, unknown>>
) => {
  if (!hasConfiguredEncryptionKey(env)) return;
  for (const row of rows) {
    if (typeof row.id !== 'number' || typeof row.person_id !== 'string' || !needsReencryption(env, row.value)) {
      continue;
    }
    const encrypted = await reencryptProtectedValue(env, row.value, customFieldRowContext(row));
    if (!encrypted || encrypted === row.value) continue;
    await db.prepare(
      'UPDATE person_custom_fields SET value = ? WHERE id = ? AND value = ?'
    ).bind(encrypted, row.id, row.value).run();
  }
};
