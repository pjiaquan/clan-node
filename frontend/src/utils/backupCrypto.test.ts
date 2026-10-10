import { describe, expect, it } from 'vitest';
import {
  MIN_BACKUP_PASSPHRASE_LENGTH,
  decryptBackupPayload,
  encryptBackupPayload,
  isEncryptedBackupPayload,
} from './backupCrypto';
import type { EncryptedNodeBackupPayload, NodeBackupPayload } from '../types';

const PASSPHRASE = 'correct horse battery staple';
const payload = { version: 1, people: [{ id: 'p1', name: '王小明' }] } as unknown as NodeBackupPayload;

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

/** Builds a v1 file the way the previous implementation did: 250k, no AAD. */
const buildLegacyBackup = async (): Promise<EncryptedNodeBackupPayload> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(PASSPHRASE), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 250000 },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload))
  );
  return {
    format: 'clan-node-backup-encrypted',
    version: 1,
    encrypted_at: '2026-01-01T00:00:00.000Z',
    kdf: { algorithm: 'PBKDF2', hash: 'SHA-256', iterations: 250000, salt: toBase64Url(salt) },
    cipher: { algorithm: 'AES-GCM', iv: toBase64Url(iv) },
    data: toBase64Url(new Uint8Array(ciphertext)),
  };
};

describe('backup encryption', () => {
  it('round-trips at the current version', async () => {
    const encrypted = await encryptBackupPayload(payload, PASSPHRASE);
    expect(encrypted.version).toBe(2);
    expect(encrypted.kdf.iterations).toBe(600000);
    expect(isEncryptedBackupPayload(encrypted)).toBe(true);

    expect(await decryptBackupPayload(encrypted, PASSPHRASE)).toEqual(payload);
  });

  it('uses a fresh salt and IV for every export', async () => {
    const first = await encryptBackupPayload(payload, PASSPHRASE);
    const second = await encryptBackupPayload(payload, PASSPHRASE);
    expect(first.kdf.salt).not.toBe(second.kdf.salt);
    expect(first.cipher.iv).not.toBe(second.cipher.iv);
    expect(first.data).not.toBe(second.data);
  });

  it('refuses a passphrase below the floor', async () => {
    await expect(encryptBackupPayload(payload, 'short')).rejects.toThrow(/at least 12 characters/);
    await expect(encryptBackupPayload(payload, '   ')).rejects.toThrow(/required/);
    // Exactly at the floor is accepted.
    await expect(encryptBackupPayload(payload, 'x'.repeat(MIN_BACKUP_PASSPHRASE_LENGTH))).resolves.toBeTruthy();
  });

  it('rejects the wrong passphrase', async () => {
    const encrypted = await encryptBackupPayload(payload, PASSPHRASE);
    await expect(decryptBackupPayload(encrypted, 'wrong passphrase here'))
      .rejects.toThrow(/Invalid backup passphrase or corrupted/);
  });

  it('detects tampering with the ciphertext', async () => {
    const encrypted = await encryptBackupPayload(payload, PASSPHRASE);
    const flipped = { ...encrypted, data: `${encrypted.data.slice(0, -2)}${encrypted.data.endsWith('A') ? 'B' : 'A'}` };
    await expect(decryptBackupPayload(flipped, PASSPHRASE)).rejects.toThrow();
  });

  it('detects tampering with the header, which v1 could not', async () => {
    const encrypted = await encryptBackupPayload(payload, PASSPHRASE);

    // encrypted_at is cosmetic but now bound, so editing it is detected.
    await expect(decryptBackupPayload(
      { ...encrypted, encrypted_at: '1999-01-01T00:00:00.000Z' },
      PASSPHRASE
    )).rejects.toThrow();

    // A declared iteration count cannot be lowered to make the KDF cheaper.
    await expect(decryptBackupPayload(
      { ...encrypted, kdf: { ...encrypted.kdf, iterations: 1000 } },
      PASSPHRASE
    )).rejects.toThrow();
  });

  it('still decrypts a v1 file written by the previous version', async () => {
    const legacy = await buildLegacyBackup();
    expect(isEncryptedBackupPayload(legacy)).toBe(true);
    // No AAD, and the 250k cost is chosen from the version, not the header.
    expect(await decryptBackupPayload(legacy, PASSPHRASE)).toEqual(payload);
  });

  it('refuses an unknown version', async () => {
    const encrypted = await encryptBackupPayload(payload, PASSPHRASE);
    const future = { ...encrypted, version: 99 } as unknown as EncryptedNodeBackupPayload;
    expect(isEncryptedBackupPayload(future)).toBe(false);
    await expect(decryptBackupPayload(future, PASSPHRASE)).rejects.toThrow(/Unsupported backup version/);
  });
});
