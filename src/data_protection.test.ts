import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasConfiguredEncryptionKey,
  isEncryptedValue,
  encryptProtectedValue,
  decryptProtectedValue,
  ENCRYPTED_VALUE_PREFIX
} from './data_protection';

// Node 18+ provides crypto globally

const VALID_KEY = 'J8aBKt9I_ePkEJ1b_lYDXkft6MGLD48fDKJD42Uaep4'; // base64url 32 bytes

test('hasConfiguredEncryptionKey returns true if valid key is set', () => {
  assert.equal(hasConfiguredEncryptionKey({ AUTH_ENCRYPTION_KEY: VALID_KEY } as any), true);
});

test('hasConfiguredEncryptionKey returns false if key is not set or empty', () => {
  assert.equal(hasConfiguredEncryptionKey({} as any), false);
  assert.equal(hasConfiguredEncryptionKey({ AUTH_ENCRYPTION_KEY: '' } as any), false);
  assert.equal(hasConfiguredEncryptionKey({ AUTH_ENCRYPTION_KEY: '   ' } as any), false);
});

test('isEncryptedValue identifies encrypted values', () => {
  assert.equal(isEncryptedValue(`${ENCRYPTED_VALUE_PREFIX}:iv:cipher`), true);
  assert.equal(isEncryptedValue('enc:v2:iv:cipher'), false);
  assert.equal(isEncryptedValue('plaintext'), false);
  assert.equal(isEncryptedValue(''), false);
  assert.equal(isEncryptedValue(null), false);
  assert.equal(isEncryptedValue(undefined), false);
});

test('encryptProtectedValue and decryptProtectedValue round-trip successfully', async () => {
  const env = { AUTH_ENCRYPTION_KEY: VALID_KEY } as any;
  const plaintext = 'super secret data';

  const encrypted = await encryptProtectedValue(env, plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.ok(encrypted?.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`), 'Encrypted value must have correct prefix');

  const parts = encrypted?.split(':');
  assert.equal(parts?.length, 4, 'Encrypted string must consist of 4 parts');

  const decrypted = await decryptProtectedValue(env, encrypted);
  assert.equal(decrypted, plaintext, 'Decrypted value must match original plaintext');
});

test('encryptProtectedValue handles null, undefined, empty string', async () => {
  const env = { AUTH_ENCRYPTION_KEY: VALID_KEY } as any;
  assert.equal(await encryptProtectedValue(env, null), null);
  assert.equal(await encryptProtectedValue(env, undefined), null);
  assert.equal(await encryptProtectedValue(env, ''), '');
});

test('decryptProtectedValue handles null, undefined, empty string', async () => {
  const env = { AUTH_ENCRYPTION_KEY: VALID_KEY } as any;
  assert.equal(await decryptProtectedValue(env, null), null);
  assert.equal(await decryptProtectedValue(env, undefined), null);
  assert.equal(await decryptProtectedValue(env, ''), '');
});

test('encryptProtectedValue returns plaintext if key is not configured', async () => {
  const env = {} as any;
  const plaintext = 'secret';
  const result = await encryptProtectedValue(env, plaintext);
  assert.equal(result, plaintext, 'Should return plaintext if key missing');
});

test('decryptProtectedValue returns original if not encrypted string', async () => {
  const env = { AUTH_ENCRYPTION_KEY: VALID_KEY } as any;
  const val = 'plaintext';
  const result = await decryptProtectedValue(env, val);
  assert.equal(result, val, 'Should return unchanged if not an encrypted string');
});

test('decryptProtectedValue throws if payload is invalid', async () => {
  const env = { AUTH_ENCRYPTION_KEY: VALID_KEY } as any;
  await assert.rejects(
    async () => decryptProtectedValue(env, `${ENCRYPTED_VALUE_PREFIX}:invalid`),
    { message: 'Invalid encrypted value payload' }
  );
});

test('decryptProtectedValue throws if key missing but string is encrypted', async () => {
  const env = {} as any;
  await assert.rejects(
    async () => decryptProtectedValue(env, `${ENCRYPTED_VALUE_PREFIX}:fake:fake`),
    { message: 'AUTH_ENCRYPTION_KEY is required to decrypt protected values' }
  );
});
