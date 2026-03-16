import type { Env } from './types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
export const ENCRYPTED_VALUE_PREFIX = 'enc:v1';

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
    if (env.ENVIRONMENT === 'production' && !encryptionKeyWarningShown) {
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
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  cachedEncryptionKeySource = keySource;
  return cachedEncryptionKey;
};

export const isEncryptedValue = (value: string | null | undefined) => (
  Boolean(value && value.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`))
);

export const encryptProtectedValue = async (env: Env, plaintext: string | null | undefined): Promise<string | null> => {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext ?? null;
  const key = await getEncryptionKey(env);
  if (!key) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(plaintext)
  );
  return `${ENCRYPTED_VALUE_PREFIX}:${toBase64Url(iv)}:${toBase64Url(cipher)}`;
};

export const decryptProtectedValue = async (env: Env, value: string | null | undefined): Promise<string | null> => {
  if (value === null || value === undefined || value === '') return value ?? null;
  if (!isEncryptedValue(value)) {
    return value;
  }
  const parts = value.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted value payload');
  }
  const key = await getEncryptionKey(env);
  if (!key) {
    throw new Error('AUTH_ENCRYPTION_KEY is required to decrypt protected values');
  }
  const iv = fromBase64Url(parts[2]);
  const cipher = fromBase64Url(parts[3]);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipher
  );
  return textDecoder.decode(plaintext);
};

const PERSON_PROTECTED_FIELDS = ['blood_type', 'dob', 'dod', 'tob', 'tod', 'metadata'] as const;
type PersonProtectedField = typeof PERSON_PROTECTED_FIELDS[number];

export const protectPersonWriteFields = async (
  env: Env,
  fields: Partial<Record<PersonProtectedField, string | null | undefined>>
) => {
  const next: Partial<Record<PersonProtectedField, string | null>> = {};
  for (const field of PERSON_PROTECTED_FIELDS) {
    if (field in fields) {
      next[field] = await encryptProtectedValue(env, fields[field]);
    }
  }
  return next;
};

export const decryptPersonRow = async <T extends Record<string, unknown>>(env: Env, row: T): Promise<T> => {
  const next = { ...row } as Record<string, unknown>;
  for (const field of PERSON_PROTECTED_FIELDS) {
    if (field in next) {
      next[field] = await decryptProtectedValue(env, (next[field] as string | null | undefined) ?? null);
    }
  }
  return next as T;
};

export const migratePlaintextPersonRow = async (
  db: D1Database,
  env: Env,
  row: Record<string, unknown>
) => {
  if (!hasConfiguredEncryptionKey(env) || typeof row.id !== 'string') return;
  const updates: string[] = [];
  const values: string[] = [];
  for (const field of PERSON_PROTECTED_FIELDS) {
    const rawValue = row[field];
    if (typeof rawValue !== 'string' || !rawValue || isEncryptedValue(rawValue)) continue;
    const encrypted = await encryptProtectedValue(env, rawValue);
    if (!encrypted || encrypted === rawValue) continue;
    updates.push(`${field} = ?`);
    values.push(encrypted);
  }
  if (!updates.length) return;
  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  await db.prepare(
    `UPDATE people SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values, row.id).run();
};

export const decryptCustomFieldRows = async <T extends Record<string, unknown>>(env: Env, rows: T[]): Promise<T[]> => (
  Promise.all(rows.map(async (row) => ({
    ...row,
    value: await decryptProtectedValue(env, (row.value as string | null | undefined) ?? null)
  } as T)))
);

export const migratePlaintextCustomFieldRows = async (
  db: D1Database,
  env: Env,
  rows: Array<Record<string, unknown>>
) => {
  if (!hasConfiguredEncryptionKey(env)) return;
  for (const row of rows) {
    if (typeof row.id !== 'number' || typeof row.value !== 'string' || !row.value || isEncryptedValue(row.value)) {
      continue;
    }
    const encrypted = await encryptProtectedValue(env, row.value);
    if (!encrypted || encrypted === row.value) continue;
    await db.prepare(
      'UPDATE person_custom_fields SET value = ?, updated_at = ? WHERE id = ?'
    ).bind(encrypted, new Date().toISOString(), row.id).run();
  }
};
