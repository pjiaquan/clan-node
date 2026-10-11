import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasConfiguredEncryptionKey,
  isEncryptedValue,
  isLegacyEncryptedValue,
  encryptProtectedValue,
  decryptProtectedValue,
  decryptPersonRow,
  decryptCustomFieldRows,
  protectPersonWriteFields,
  migratePlaintextPersonRow,
  migratePlaintextCustomFieldRows,
  personFieldContext,
  customFieldContext,
  ENCRYPTED_VALUE_PREFIX,
  LEGACY_ENCRYPTED_VALUE_PREFIX,
} from './data_protection';

// Node 18+ provides crypto globally

const VALID_KEY = 'J8aBKt9I_ePkEJ1b_lYDXkft6MGLD48fDKJD42Uaep4'; // base64url 32 bytes
const CTX = personFieldContext('person-a', 'dob');

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
  assert.equal(isEncryptedValue(`${LEGACY_ENCRYPTED_VALUE_PREFIX}:iv:cipher`), true);
  assert.equal(isEncryptedValue('enc:v3:iv:cipher'), false);
  assert.equal(isEncryptedValue('plaintext'), false);
  assert.equal(isEncryptedValue(''), false);
  assert.equal(isEncryptedValue(null), false);
  assert.equal(isEncryptedValue(undefined), false);
});

test('encryptProtectedValue and decryptProtectedValue round-trip successfully', async () => {
  const env = { AUTH_ENCRYPTION_KEY: VALID_KEY } as any;
  const plaintext = 'super secret data';

  const encrypted = await encryptProtectedValue(env, plaintext, CTX);
  assert.notEqual(encrypted, plaintext);
  assert.ok(encrypted?.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`), 'Encrypted value must have correct prefix');

  const parts = encrypted?.split(':');
  assert.equal(parts?.length, 4, 'Encrypted string must consist of 4 parts');

  const decrypted = await decryptProtectedValue(env, encrypted, CTX);
  assert.equal(decrypted, plaintext, 'Decrypted value must match original plaintext');
});

test('encryptProtectedValue handles null, undefined, empty string', async () => {
  const env = { AUTH_ENCRYPTION_KEY: VALID_KEY } as any;
  assert.equal(await encryptProtectedValue(env, null, CTX), null);
  assert.equal(await encryptProtectedValue(env, undefined, CTX), null);
  assert.equal(await encryptProtectedValue(env, '', CTX), '');
});

test('decryptProtectedValue handles null, undefined, empty string', async () => {
  const env = { AUTH_ENCRYPTION_KEY: VALID_KEY } as any;
  assert.equal(await decryptProtectedValue(env, null, CTX), null);
  assert.equal(await decryptProtectedValue(env, undefined, CTX), null);
  assert.equal(await decryptProtectedValue(env, '', CTX), '');
});

test('encryptProtectedValue returns plaintext if key is not configured', async () => {
  const env = {} as any;
  const plaintext = 'secret';
  const result = await encryptProtectedValue(env, plaintext, CTX);
  assert.equal(result, plaintext, 'Should return plaintext if key missing');
});

test('decryptProtectedValue returns original if not encrypted string', async () => {
  const env = { AUTH_ENCRYPTION_KEY: VALID_KEY } as any;
  const val = 'plaintext';
  const result = await decryptProtectedValue(env, val, CTX);
  assert.equal(result, val, 'Should return unchanged if not an encrypted string');
});

test('decryptProtectedValue throws if payload is invalid', async () => {
  const env = { AUTH_ENCRYPTION_KEY: VALID_KEY } as any;
  await assert.rejects(
    async () => decryptProtectedValue(env, `${ENCRYPTED_VALUE_PREFIX}:invalid`, CTX),
    { message: 'Invalid encrypted value payload' }
  );
});

test('decryptProtectedValue throws if key missing but string is encrypted', async () => {
  const env = {} as any;
  await assert.rejects(
    async () => decryptProtectedValue(env, `${ENCRYPTED_VALUE_PREFIX}:fake:fake`, CTX),
    { message: 'AUTH_ENCRYPTION_KEY is required to decrypt protected values' }
  );
});

// --- AAD binding (enc:v2) -------------------------------------------------

const ENV = { AUTH_ENCRYPTION_KEY: VALID_KEY } as any;
const REJECT_LEGACY_ENV = { AUTH_ENCRYPTION_KEY: VALID_KEY, DATA_PROTECTION_REJECT_LEGACY: 'true' } as any;

/** Builds a value exactly as the v1 implementation did: same key, no AAD. */
const legacyEncrypt = async (plaintext: string) => {
  const raw = Buffer.from(VALID_KEY, 'base64url');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return `${LEGACY_ENCRYPTED_VALUE_PREFIX}:${Buffer.from(iv).toString('base64url')}:${Buffer.from(cipher).toString('base64url')}`;
};

test('new values are written as enc:v2', async () => {
  const encrypted = await encryptProtectedValue(ENV, '1950-01-01', CTX);
  assert.ok(encrypted?.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`));
  assert.equal(isLegacyEncryptedValue(encrypted), false);
});

test('a value moved to another person does not decrypt', async () => {
  const encrypted = await encryptProtectedValue(ENV, '1950-01-01', personFieldContext('person-a', 'dob'));
  await assert.rejects(() => decryptProtectedValue(ENV, encrypted, personFieldContext('person-b', 'dob')));
});

test('a value moved to another column of the same person does not decrypt', async () => {
  const encrypted = await encryptProtectedValue(ENV, '1950-01-01', personFieldContext('person-a', 'dob'));
  await assert.rejects(() => decryptProtectedValue(ENV, encrypted, personFieldContext('person-a', 'dod')));
});

test('a custom field value moved to another person or label does not decrypt', async () => {
  const encrypted = await encryptProtectedValue(ENV, '0912-345-678', customFieldContext('person-a', 'phone'));
  assert.equal(await decryptProtectedValue(ENV, encrypted, customFieldContext('person-a', 'phone')), '0912-345-678');
  await assert.rejects(() => decryptProtectedValue(ENV, encrypted, customFieldContext('person-b', 'phone')));
  await assert.rejects(() => decryptProtectedValue(ENV, encrypted, customFieldContext('person-a', 'address')));
});

test('people and custom field values are domain-separated', async () => {
  const encrypted = await encryptProtectedValue(ENV, 'x', personFieldContext('person-a', 'metadata'));
  await assert.rejects(() => decryptProtectedValue(ENV, encrypted, customFieldContext('person-a', 'metadata')));
});

test('the AAD encoding is unambiguous for user-supplied ids and labels', async () => {
  // With a delimiter-joined encoding these two contexts would serialise identically.
  const encrypted = await encryptProtectedValue(ENV, 'x', customFieldContext('a|b', 'c'));
  await assert.rejects(() => decryptProtectedValue(ENV, encrypted, customFieldContext('a', 'b|c')));
  const quoted = await encryptProtectedValue(ENV, 'x', customFieldContext('a","b', 'c'));
  await assert.rejects(() => decryptProtectedValue(ENV, quoted, customFieldContext('a', 'b","c')));
});

test('a v2 value relabelled as v1 does not decrypt', async () => {
  const encrypted = await encryptProtectedValue(ENV, '1950-01-01', CTX);
  const downgraded = encrypted!.replace(`${ENCRYPTED_VALUE_PREFIX}:`, `${LEGACY_ENCRYPTED_VALUE_PREFIX}:`);
  await assert.rejects(() => decryptProtectedValue(ENV, downgraded, CTX));
});

test('legacy v1 values still decrypt while the legacy format is accepted', async () => {
  const legacy = await legacyEncrypt('1950-01-01');
  assert.equal(await decryptProtectedValue(ENV, legacy, CTX), '1950-01-01');
});

test('DATA_PROTECTION_REJECT_LEGACY refuses v1 and keeps v2 working', async () => {
  const legacy = await legacyEncrypt('1950-01-01');
  await assert.rejects(
    () => decryptProtectedValue(REJECT_LEGACY_ENV, legacy, CTX),
    { message: 'Legacy enc:v1 protected values are no longer accepted' }
  );
  const current = await encryptProtectedValue(REJECT_LEGACY_ENV, '1950-01-01', CTX);
  assert.equal(await decryptProtectedValue(REJECT_LEGACY_ENV, current, CTX), '1950-01-01');
});

test('person rows round-trip through protectPersonWriteFields and decryptPersonRow', async () => {
  const fields = await protectPersonWriteFields(ENV, 'person-a', { dob: '1950-01-01', metadata: '{"k":1}' });
  const row = { id: 'person-a', name: 'A', dob: fields.dob, metadata: fields.metadata };
  const decrypted = await decryptPersonRow(ENV, row);
  assert.equal(decrypted.dob, '1950-01-01');
  assert.equal(decrypted.metadata, '{"k":1}');
  await assert.rejects(() => decryptPersonRow(ENV, { ...row, id: 'person-b' }));
});

test('custom field rows decrypt against their own person_id and label', async () => {
  const value = await encryptProtectedValue(ENV, 'v', customFieldContext('person-a', 'phone'));
  const [decrypted] = await decryptCustomFieldRows(ENV, [{ id: 1, person_id: 'person-a', label: 'phone', value }]);
  assert.equal(decrypted.value, 'v');
  await assert.rejects(() => decryptCustomFieldRows(ENV, [{ id: 1, person_id: 'person-a', label: 'email', value }]));
});

// --- migration -------------------------------------------------------------

type Captured = { sql: string; params: unknown[] };
const fakeDb = () => {
  const statements: Captured[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return { run: async () => { statements.push({ sql, params }); return { success: true }; } };
        },
      };
    },
  } as unknown as D1Database;
  return { db, statements };
};

test('migratePlaintextPersonRow rewrites plaintext and v1 values as bound v2, guarded by the old values', async () => {
  const legacyDod = await legacyEncrypt('2020-02-02');
  const current = await encryptProtectedValue(ENV, 'A+', personFieldContext('person-a', 'blood_type'));
  const { db, statements } = fakeDb();
  await migratePlaintextPersonRow(db, ENV, {
    id: 'person-a', dob: '1950-01-01', dod: legacyDod, blood_type: current, tob: null,
  });

  assert.equal(statements.length, 1);
  const [{ sql, params }] = statements;
  assert.equal(sql, 'UPDATE people SET dob = ?, dod = ? WHERE id = ? AND dob = ? AND dod = ?');
  assert.doesNotMatch(sql, /updated_at/);
  const [newDob, newDod, id, oldDob, oldDod] = params as string[];
  assert.equal(id, 'person-a');
  assert.equal(oldDob, '1950-01-01');
  assert.equal(oldDod, legacyDod);
  assert.equal(await decryptProtectedValue(REJECT_LEGACY_ENV, newDob, personFieldContext('person-a', 'dob')), '1950-01-01');
  assert.equal(await decryptProtectedValue(REJECT_LEGACY_ENV, newDod, personFieldContext('person-a', 'dod')), '2020-02-02');
});

test('migratePlaintextPersonRow leaves rows that are already v2 alone', async () => {
  const current = await encryptProtectedValue(ENV, '1950-01-01', CTX);
  const { db, statements } = fakeDb();
  await migratePlaintextPersonRow(db, ENV, { id: 'person-a', dob: current });
  assert.equal(statements.length, 0);
});

test('migratePlaintextPersonRow will not launder v1 values once they are rejected', async () => {
  const legacy = await legacyEncrypt('1950-01-01');
  const { db, statements } = fakeDb();
  await migratePlaintextPersonRow(db, REJECT_LEGACY_ENV, { id: 'person-a', dob: legacy });
  assert.equal(statements.length, 0);
});

test('migratePlaintextCustomFieldRows rewrites plaintext and v1 values as bound v2 with a compare-and-swap', async () => {
  const legacy = await legacyEncrypt('0912');
  const { db, statements } = fakeDb();
  await migratePlaintextCustomFieldRows(db, ENV, [
    { id: 1, person_id: 'person-a', label: 'phone', value: legacy },
    { id: 2, person_id: 'person-a', label: 'note', value: 'plain' },
    { id: 3, label: 'orphan', value: 'skipped: no person_id' },
  ]);

  assert.equal(statements.length, 2);
  for (const { sql } of statements) {
    assert.equal(sql, 'UPDATE person_custom_fields SET value = ? WHERE id = ? AND value = ?');
  }
  const [phone, note] = statements;
  assert.deepEqual(phone.params.slice(1), [1, legacy]);
  assert.equal(await decryptProtectedValue(REJECT_LEGACY_ENV, phone.params[0] as string, customFieldContext('person-a', 'phone')), '0912');
  assert.deepEqual(note.params.slice(1), [2, 'plain']);
  assert.equal(await decryptProtectedValue(REJECT_LEGACY_ENV, note.params[0] as string, customFieldContext('person-a', 'note')), 'plain');
});

test('protectPersonWriteFields skips undefined fields and keeps explicit nulls', async () => {
  const fields = await protectPersonWriteFields(ENV, 'person-a', { dob: undefined, dod: null, tob: '08:00' });
  assert.equal('dob' in fields, false, 'an omitted field must not be written');
  assert.equal(fields.dod, null, 'an explicit null still clears the column');
  assert.ok(fields.tob?.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`));
});
