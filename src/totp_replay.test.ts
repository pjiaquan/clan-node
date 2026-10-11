import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { consumeTotpCounter, generateTotpCodeForCounter, verifyTotpCode } from './auth';
import { SqliteD1Database } from './selfhost/sqlite_d1';

const SECRET = 'JBSWY3DPEHPK3PXP';
const PERIOD = 30;
const currentCounter = () => Math.floor(Date.now() / 1000 / PERIOD);

const dir = await mkdtemp(path.join(tmpdir(), 'clan-totp-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));
db.rawDb.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, mfa_totp_last_counter INTEGER);
`);

const schema = { hasMfaTotpLastCounter: true } as any;
const schemaWithoutColumn = { hasMfaTotpLastCounter: false } as any;

let counter = 0;
const newUser = async () => {
  const id = `user-${counter += 1}`;
  await db.prepare('INSERT INTO users (id, mfa_totp_last_counter) VALUES (?, NULL)').bind(id).run();
  return id;
};

const lastCounterOf = async (id: string) => (
  ((await db.prepare('SELECT mfa_totp_last_counter FROM users WHERE id = ?').bind(id).first()) as any)
    ?.mfa_totp_last_counter
);

test('verifyTotpCode reports which time-step matched', async () => {
  const now = currentCounter();

  assert.equal(await verifyTotpCode(SECRET, await generateTotpCodeForCounter(SECRET, now)), now);
  // The +/-1 step tolerance is what makes a captured code reusable.
  assert.equal(await verifyTotpCode(SECRET, await generateTotpCodeForCounter(SECRET, now - 1)), now - 1);
  assert.equal(await verifyTotpCode(SECRET, await generateTotpCodeForCounter(SECRET, now + 1)), now + 1);
  // Outside the window, and malformed input.
  assert.equal(await verifyTotpCode(SECRET, await generateTotpCodeForCounter(SECRET, now + 5)), null);
  assert.equal(await verifyTotpCode(SECRET, '000000'), null);
  assert.equal(await verifyTotpCode(SECRET, 'abcdef'), null);
  assert.equal(await verifyTotpCode(SECRET, '12345'), null);
});

test('a time-step can only be consumed once', async () => {
  const id = await newUser();
  const step = currentCounter();

  assert.equal(await consumeTotpCounter(db as any, id, step, schema), true);
  assert.equal(await lastCounterOf(id), step);

  // Replaying the same code within the tolerance window must be refused.
  assert.equal(await consumeTotpCounter(db as any, id, step, schema), false);
  // As must an earlier step still inside the window.
  assert.equal(await consumeTotpCounter(db as any, id, step - 1, schema), false);
  // The next step is fine.
  assert.equal(await consumeTotpCounter(db as any, id, step + 1, schema), true);
  assert.equal(await lastCounterOf(id), step + 1);
});

test('concurrent use of one code admits exactly one request', async () => {
  const id = await newUser();
  const step = currentCounter();

  const outcomes = await Promise.all(
    Array.from({ length: 20 }, () => consumeTotpCounter(db as any, id, step, schema))
  );

  assert.equal(outcomes.filter(Boolean).length, 1, 'only one concurrent replay may win');
  assert.equal(await lastCounterOf(id), step);
});

test('users do not share a counter', async () => {
  const first = await newUser();
  const second = await newUser();
  const step = currentCounter();

  assert.equal(await consumeTotpCounter(db as any, first, step, schema), true);
  assert.equal(await consumeTotpCounter(db as any, second, step, schema), true);
});

test('replay protection is skipped when the column has not been added yet', async () => {
  const id = await newUser();
  const step = currentCounter();

  // The column is created by addColumnIfMissing; until then verification must
  // keep working rather than failing closed on every sign-in.
  assert.equal(await consumeTotpCounter(db as any, id, step, schemaWithoutColumn), true);
  assert.equal(await consumeTotpCounter(db as any, id, step, schemaWithoutColumn), true);
  assert.equal(await lastCounterOf(id), null, 'nothing is recorded without the column');
});
