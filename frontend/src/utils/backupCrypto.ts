import type { EncryptedNodeBackupPayload, NodeBackupPayload } from '../types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const BACKUP_ENCRYPTION_FORMAT = 'clan-node-backup-encrypted';

/**
 * Backup envelope versions.
 *
 * v1 derived at 250,000 PBKDF2 iterations and bound nothing as AAD. A backup
 * file holds every member's name, e-mail and dates, so a weak passphrase on a
 * leaked file was cheap to brute force; the header was also editable without
 * detection. v2 raises the cost to OWASP's current floor and binds the header.
 *
 * The iteration count is chosen by version rather than read from the file, so
 * editing the declared value cannot downgrade the KDF.
 */
const BACKUP_ENCRYPTION_VERSION = 2;
const PBKDF2_ITERATIONS_BY_VERSION: Record<number, number> = {
  1: 250000,
  2: 600000,
};
const PBKDF2_ITERATIONS = PBKDF2_ITERATIONS_BY_VERSION[BACKUP_ENCRYPTION_VERSION];

/**
 * A passphrase protects the whole family's personal data with nothing but
 * PBKDF2 in front of it, so a floor is enforced rather than merely suggested.
 */
export const MIN_BACKUP_PASSPHRASE_LENGTH = 12;

const toBase64Url = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/**
 * The header, bound into the AEAD so it cannot be edited undetected.
 * Reconstructed identically on decrypt from the file's own fields.
 */
const headerAad = (payload: EncryptedNodeBackupPayload) => textEncoder.encode([
  payload.format,
  String(payload.version),
  payload.encrypted_at,
  payload.kdf.algorithm,
  payload.kdf.hash,
  String(payload.kdf.iterations),
  payload.kdf.salt,
  payload.cipher.algorithm,
  payload.cipher.iv,
].join('|'));

const deriveKey = async (passphrase: string, salt: Uint8Array, iterations: number) => {
  const normalizedSalt = new Uint8Array(salt.byteLength);
  normalizedSalt.set(salt);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: normalizedSalt,
      iterations,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const isEncryptedBackupPayload = (value: unknown): value is EncryptedNodeBackupPayload => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.format === BACKUP_ENCRYPTION_FORMAT
    && typeof record.version === 'number'
    && record.version in PBKDF2_ITERATIONS_BY_VERSION
    && typeof record.data === 'string'
    && typeof (record.kdf as Record<string, unknown> | undefined)?.salt === 'string'
    && typeof (record.cipher as Record<string, unknown> | undefined)?.iv === 'string';
};

export const encryptBackupPayload = async (
  payload: NodeBackupPayload,
  passphrase: string
): Promise<EncryptedNodeBackupPayload> => {
  const normalizedPassphrase = passphrase.trim();
  if (!normalizedPassphrase) {
    throw new Error('Backup passphrase is required');
  }
  if (normalizedPassphrase.length < MIN_BACKUP_PASSPHRASE_LENGTH) {
    throw new Error(`Backup passphrase must be at least ${MIN_BACKUP_PASSPHRASE_LENGTH} characters`);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(normalizedPassphrase, salt, PBKDF2_ITERATIONS);

  const header: Omit<EncryptedNodeBackupPayload, 'data'> = {
    format: BACKUP_ENCRYPTION_FORMAT,
    version: BACKUP_ENCRYPTION_VERSION as EncryptedNodeBackupPayload['version'],
    encrypted_at: new Date().toISOString(),
    kdf: {
      algorithm: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: toBase64Url(salt),
    },
    cipher: {
      algorithm: 'AES-GCM',
      iv: toBase64Url(iv),
    },
  };

  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: headerAad({ ...header, data: '' }) },
    key,
    plaintext
  );

  return { ...header, data: toBase64Url(ciphertext) };
};

export const decryptBackupPayload = async (
  payload: EncryptedNodeBackupPayload,
  passphrase: string
): Promise<NodeBackupPayload> => {
  const normalizedPassphrase = passphrase.trim();
  if (!normalizedPassphrase) {
    throw new Error('Backup passphrase is required');
  }

  const iterations = PBKDF2_ITERATIONS_BY_VERSION[payload.version];
  if (!iterations) {
    throw new Error('Unsupported backup version');
  }

  const salt = fromBase64Url(payload.kdf.salt);
  const iv = fromBase64Url(payload.cipher.iv);
  const ciphertext = fromBase64Url(payload.data);
  const key = await deriveKey(normalizedPassphrase, salt, iterations);

  // v1 files were written without AAD, so only v2 binds the header.
  const algorithm: AesGcmParams = payload.version >= 2
    ? { name: 'AES-GCM', iv, additionalData: headerAad({ ...payload, data: '' }) }
    : { name: 'AES-GCM', iv };

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(algorithm, key, ciphertext);
  } catch {
    throw new Error('Invalid backup passphrase or corrupted backup file');
  }

  const parsed = JSON.parse(textDecoder.decode(plaintext)) as NodeBackupPayload;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid decrypted backup payload');
  }
  return parsed;
};
