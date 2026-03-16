import type { EncryptedNodeBackupPayload, NodeBackupPayload } from '../types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const BACKUP_ENCRYPTION_FORMAT = 'clan-node-backup-encrypted';
const BACKUP_ENCRYPTION_VERSION = 1;
const PBKDF2_ITERATIONS = 250000;

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

const deriveKey = async (passphrase: string, salt: Uint8Array) => {
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
      iterations: PBKDF2_ITERATIONS,
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
    && record.version === BACKUP_ENCRYPTION_VERSION
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

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(normalizedPassphrase, salt);
  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  return {
    format: BACKUP_ENCRYPTION_FORMAT,
    version: BACKUP_ENCRYPTION_VERSION,
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
    data: toBase64Url(ciphertext),
  };
};

export const decryptBackupPayload = async (
  payload: EncryptedNodeBackupPayload,
  passphrase: string
): Promise<NodeBackupPayload> => {
  const normalizedPassphrase = passphrase.trim();
  if (!normalizedPassphrase) {
    throw new Error('Backup passphrase is required');
  }

  const salt = fromBase64Url(payload.kdf.salt);
  const iv = fromBase64Url(payload.cipher.iv);
  const ciphertext = fromBase64Url(payload.data);
  const key = await deriveKey(normalizedPassphrase, salt);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch {
    throw new Error('Invalid backup passphrase or corrupted backup file');
  }

  const parsed = JSON.parse(textDecoder.decode(plaintext)) as NodeBackupPayload;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid decrypted backup payload');
  }
  return parsed;
};
