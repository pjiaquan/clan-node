import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { registerPeopleRoutes } from './people';
import { SqliteD1Database } from './selfhost/sqlite_d1';
import { FIELD_LIMITS, ValidationError } from './validation';
import type { AppBindings, Env } from './types';

/**
 * Write routes used to destructure the parsed body and bind the values
 * straight into D1, so a wrong type or an out-of-range enum surfaced as a 500
 * carrying the driver's message. Run against real SQLite so the CHECK
 * constraints and NOT NULL columns are the real ones.
 */
const schemaSql = await readFile(path.resolve('migrations/schema.sql'), 'utf8');
const dir = await mkdtemp(path.join(tmpdir(), 'clan-validation-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));
db.rawDb.exec(schemaSql);
await db.prepare(
  `INSERT INTO users (id, username, email, password_hash, password_salt, role)
   VALUES ('user-1', 'admin@example.com', 'admin@example.com', 'x', 'y', 'admin')`
).run();

const app = new Hono<AppBindings>();
// Same shape as src/index.ts, so the handler under test is the real one.
app.onError((error, c) => {
  if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
  if (error instanceof SyntaxError) return c.json({ error: 'Body must be valid JSON' }, 400);
  return c.json({ error: 'Internal server error' }, 500);
});
app.use('/api/people/*', async (c, next) => {
  c.set('sessionUser', { userId: 'user-1', username: 'admin@example.com', role: 'admin' });
  await next();
});
app.use('/api/people', async (c, next) => {
  c.set('sessionUser', { userId: 'user-1', username: 'admin@example.com', role: 'admin' });
  await next();
});
registerPeopleRoutes(app);

const env = { DB: db as unknown as D1Database, AVATARS: {} as any, ENVIRONMENT: 'development' } as Env;

const createPerson = (body: unknown) => app.request(
  '/api/people',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  env
);

const peopleCount = async () => Number(
  ((await db.prepare('SELECT COUNT(*) AS count FROM people').first()) as any).count
);

test('a name of the wrong type is a 400, not a database error', async () => {
  const before = await peopleCount();

  for (const name of [{ a: 1 }, 42, true, ['x'], null, '', '   ']) {
    const res = await createPerson({ name });
    assert.equal(res.status, 400, `name ${JSON.stringify(name)} should be rejected`);
    const body = await res.json() as { error: string };
    assert.match(body.error, /^name: /);
    // The driver's own message must not be handed to the client.
    assert.doesNotMatch(body.error, /SQLITE|bind|constraint/i);
  }

  assert.equal(await peopleCount(), before, 'nothing should have been written');
});

test('a gender outside the CHECK constraint is a 400', async () => {
  const res = await createPerson({ name: 'Someone', gender: 'X' });
  assert.equal(res.status, 400);
  assert.match((await res.json() as any).error, /gender: must be one of M, F, O/);
});

test('over-long text and over-sized metadata are refused', async () => {
  const tooLongName = await createPerson({ name: 'x'.repeat(FIELD_LIMITS.shortText + 1) });
  assert.equal(tooLongName.status, 400);
  assert.match((await tooLongName.json() as any).error, /at most 200 characters/);

  const hugeMetadata = await createPerson({
    name: 'Someone',
    metadata: { blob: 'x'.repeat(FIELD_LIMITS.metadataBytes + 1) },
  });
  assert.equal(hugeMetadata.status, 400);
  assert.match((await hugeMetadata.json() as any).error, /metadata: must be at most/);
});

test('over-long arrays are refused', async () => {
  const tooManyCustomFields = await createPerson({
    name: 'Someone',
    custom_fields: Array.from({ length: FIELD_LIMITS.arrayItems + 1 }, (_, i) => ({ label: `l${i}`, value: 'v' })),
  });
  assert.equal(tooManyCustomFields.status, 400);
  assert.match((await tooManyCustomFields.json() as any).error, /custom_fields: must have at most/);

  const tooManyAvatars = await createPerson({
    name: 'Someone',
    avatars: Array.from({ length: FIELD_LIMITS.arrayItems + 1 }, () => ({ avatar_url: '/api/avatars/a.png' })),
  });
  assert.equal(tooManyAvatars.status, 400);
  assert.match((await tooManyAvatars.json() as any).error, /avatars: must have at most/);
});

test('a body that is not a JSON object is refused', async () => {
  for (const body of ['[]', '"text"', 'null', '7']) {
    const res = await app.request(
      '/api/people',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body },
      env
    );
    assert.equal(res.status, 400, `${body} should be rejected`);
    assert.match((await res.json() as any).error, /body: must be a JSON object/);
  }

  const malformed = await app.request(
    '/api/people',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' },
    env
  );
  assert.equal(malformed.status, 400);
});

test('a client-chosen id has to look like an identifier', async () => {
  const res = await createPerson({ id: 'has spaces and/slashes', name: 'Someone' });
  assert.equal(res.status, 400);
  assert.match((await res.json() as any).error, /id: is not a valid identifier/);
});

test('a valid person is still created', async () => {
  const res = await createPerson({
    id: 'person-ok-1',
    name: '  Trimmed Name  ',
    english_name: 'Trimmed Name',
    gender: 'F',
    dob: '1990-01-01',
    metadata: { note: 'fine' },
  });
  assert.equal(res.status, 201);

  const row = await db.prepare('SELECT id, name, gender FROM people WHERE id = ?')
    .bind('person-ok-1').first() as any;
  assert.equal(row.name, 'Trimmed Name', 'whitespace is trimmed');
  assert.equal(row.gender, 'F');
});
