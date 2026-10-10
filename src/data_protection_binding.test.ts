import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { registerPeopleRoutes } from './people';
import { SqliteD1Database } from './selfhost/sqlite_d1';
import { ENCRYPTED_VALUE_PREFIX, LEGACY_ENCRYPTED_VALUE_PREFIX } from './data_protection';
import type { AppBindings, Env } from './types';

/**
 * Protected fields are bound to the row they were written to (enc:v2 AAD).
 * Run through the real people routes against real SQLite, so the SELECTs that
 * feed decryption are the shipped ones: a query that dropped `id` or
 * `person_id` would make every v2 value undecryptable and fail here.
 */
const KEY = 'J8aBKt9I_ePkEJ1b_lYDXkft6MGLD48fDKJD42Uaep4';

const schemaSql = await readFile(path.resolve('migrations/schema.sql'), 'utf8');
const dir = await mkdtemp(path.join(tmpdir(), 'clan-aad-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));
db.rawDb.exec(schemaSql);
await db.prepare(
  `INSERT INTO users (id, username, email, password_hash, password_salt, role)
   VALUES ('user-1', 'admin@example.com', 'admin@example.com', 'x', 'y', 'admin')`
).run();

const app = new Hono<AppBindings>();
app.onError((_error, c) => c.json({ error: 'Internal server error' }, 500));
app.use('/api/people/*', async (c, next) => {
  c.set('sessionUser', { userId: 'user-1', username: 'admin@example.com', role: 'admin' });
  await next();
});
app.use('/api/people', async (c, next) => {
  c.set('sessionUser', { userId: 'user-1', username: 'admin@example.com', role: 'admin' });
  await next();
});
registerPeopleRoutes(app);

const baseEnv = { DB: db as unknown as D1Database, AVATARS: {} as any, ENVIRONMENT: 'development', AUTH_ENCRYPTION_KEY: KEY };
const env = baseEnv as Env;
const rejectLegacyEnv = { ...baseEnv, DATA_PROTECTION_REJECT_LEGACY: 'true' } as Env;

const createPerson = async (body: Record<string, unknown>) => {
  const res = await app.request(
    '/api/people',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env
  );
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json() as { id: string }).id;
};

const getPerson = (id: string, requestEnv: Env = env) => app.request(`/api/people/${id}`, {}, requestEnv);

const storedPerson = async (id: string) => (
  await db.prepare('SELECT dob, metadata FROM people WHERE id = ?').bind(id).first()
) as { dob: string; metadata: string };

const storedCustomFields = async (id: string) => (
  (await db.prepare('SELECT label, value FROM person_custom_fields WHERE person_id = ? ORDER BY id').bind(id).all()).results
) as Array<{ label: string; value: string }>;

/** Builds a value exactly as the v1 implementation did: same key, no AAD. */
const legacyEncrypt = async (plaintext: string) => {
  const key = await crypto.subtle.importKey('raw', Buffer.from(KEY, 'base64url'), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return `${LEGACY_ENCRYPTED_VALUE_PREFIX}:${Buffer.from(iv).toString('base64url')}:${Buffer.from(cipher).toString('base64url')}`;
};

/** Read-path migration runs in the background; give it a few turns to land. */
const eventually = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 50; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('condition was not met');
};

test('a person written through the API is stored as enc:v2 and reads back', async () => {
  const id = await createPerson({
    name: 'Alice', dob: '1950-01-01', custom_fields: [{ label: 'phone', value: '0912-345-678' }],
  });

  const stored = await storedPerson(id);
  assert.ok(stored.dob.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`));
  const [field] = await storedCustomFields(id);
  assert.ok(field.value.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`));

  const res = await getPerson(id);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.dob, '1950-01-01');
  assert.deepEqual(body.metadata.customFields, [{ label: 'phone', value: '0912-345-678' }]);
});

test('a ciphertext copied onto another person is refused rather than disclosed', async () => {
  const alice = await createPerson({ name: 'Alice', dob: '1950-01-01', custom_fields: [{ label: 'phone', value: 'alice-phone' }] });
  const bob = await createPerson({ name: 'Bob', dob: '1960-06-06', custom_fields: [{ label: 'phone', value: 'bob-phone' }] });

  // Someone with write access to the database moves Alice's values onto Bob.
  const aliceDob = (await storedPerson(alice)).dob;
  await db.prepare('UPDATE people SET dob = ? WHERE id = ?').bind(aliceDob, bob).run();
  const res = await getPerson(bob);
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /1950-01-01/);

  // Same for a custom field value.
  const charlie = await createPerson({ name: 'Charlie', custom_fields: [{ label: 'phone', value: 'charlie-phone' }] });
  const [alicePhone] = await storedCustomFields(alice);
  await db.prepare('UPDATE person_custom_fields SET value = ? WHERE person_id = ?').bind(alicePhone.value, charlie).run();
  const fieldRes = await getPerson(charlie);
  assert.equal(fieldRes.status, 500);
  assert.doesNotMatch(await fieldRes.text(), /alice-phone/);
});

test('legacy v1 rows still read, are migrated to v2 on read, and then survive the v1 cut-off', async () => {
  const id = await createPerson({ name: 'Legacy' });
  const legacyDob = await legacyEncrypt('1940-04-04');
  const legacyPhone = await legacyEncrypt('legacy-phone');
  await db.prepare('UPDATE people SET dob = ?, updated_at = ? WHERE id = ?').bind(legacyDob, '2001-01-01T00:00:00.000Z', id).run();
  await db.prepare(
    'INSERT INTO person_custom_fields (person_id, label, value) VALUES (?, ?, ?)'
  ).bind(id, 'phone', legacyPhone).run();

  // Before migration, the cut-off refuses the row.
  assert.equal((await getPerson(id, rejectLegacyEnv)).status, 500);

  const res = await getPerson(id);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.dob, '1940-04-04');
  assert.deepEqual(body.metadata.customFields, [{ label: 'phone', value: 'legacy-phone' }]);

  await eventually(async () => {
    const [field] = await storedCustomFields(id);
    return (await storedPerson(id)).dob.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`)
      && field.value.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`);
  });
  const { updated_at } = await db.prepare('SELECT updated_at FROM people WHERE id = ?').bind(id).first() as any;
  assert.equal(updated_at, '2001-01-01T00:00:00.000Z', 're-encryption is not an edit');

  // Once migrated, the row reads fine with v1 refused.
  const after = await getPerson(id, rejectLegacyEnv);
  assert.equal(after.status, 200);
  const afterBody = await after.json() as any;
  assert.equal(afterBody.dob, '1940-04-04');
  assert.deepEqual(afterBody.metadata.customFields, [{ label: 'phone', value: 'legacy-phone' }]);
});
