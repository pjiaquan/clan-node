import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { registerRelationshipRoutes } from './relationships';
import { SqliteD1Database } from './selfhost/sqlite_d1';
import type { AppBindings, Env } from './types';

/**
 * `PUT /api/relationships/:id` accepted whatever endpoints it was given, while
 * the create path checked that both exist, live in the same layer and are not
 * the same person. Run against real SQLite so the repository queries and the
 * layer filter are the real ones.
 */
const schemaSql = await readFile(path.resolve('migrations/schema.sql'), 'utf8');
const dir = await mkdtemp(path.join(tmpdir(), 'clan-rel-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));
db.rawDb.exec(schemaSql);

const app = new Hono<AppBindings>();
app.use('/api/relationships/*', async (c, next) => {
  c.set('sessionUser', { userId: 'user-1', username: 'admin@example.com', role: 'admin' });
  await next();
});
registerRelationshipRoutes(app);

const env = { DB: db as unknown as D1Database, AVATARS: {} as any, ENVIRONMENT: 'development' } as Env;

const addPerson = async (id: string, layerId = 'default') => {
  await db.prepare(
    "INSERT INTO people (id, layer_id, name, gender) VALUES (?, ?, ?, 'O')"
  ).bind(id, layerId, `Person ${id}`).run();
};

const addRelationship = async (from: string, to: string, layerId = 'default') => {
  const result = await db.prepare(
    "INSERT INTO relationships (from_person_id, to_person_id, type, layer_id) VALUES (?, ?, 'parent_child', ?)"
  ).bind(from, to, layerId).run();
  return Number(result.meta.last_row_id);
};

const putRelationship = (id: number, body: Record<string, unknown>) => app.request(
  `/api/relationships/${id}`,
  { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  env
);

const relationshipRow = async (id: number) => (await db.prepare(
  'SELECT from_person_id, to_person_id FROM relationships WHERE id = ?'
).bind(id).first()) as any;

// audit_logs references users(id); without this the writes fail (silently,
// which is itself addressed separately) and clutter the output.
await db.prepare(
  `INSERT INTO users (id, username, email, password_hash, password_salt, role)
   VALUES ('user-1', 'admin@example.com', 'admin@example.com', 'x', 'y', 'admin')`
).run();

await addPerson('parent-1');
await addPerson('child-1');
await addPerson('child-2');
await addPerson('other-layer-person', 'layer-b');

test('an endpoint that does not exist is refused', async () => {
  const id = await addRelationship('parent-1', 'child-1');

  const response = await putRelationship(id, { to_person_id: 'does-not-exist' });
  assert.equal(response.status, 404);
  assert.match(await response.text(), /not found/);

  const row = await relationshipRow(id);
  assert.equal(row.to_person_id, 'child-1', 'the edge must be unchanged');
});

test('an endpoint in another layer is refused', async () => {
  const id = await addRelationship('parent-1', 'child-1');

  // `personExists` is scoped to the relationship's own layer, so a person who
  // exists but belongs elsewhere must not become an endpoint.
  const response = await putRelationship(id, { to_person_id: 'other-layer-person' });
  assert.equal(response.status, 404);
  assert.equal((await relationshipRow(id)).to_person_id, 'child-1');
});

test('an edge cannot be pointed at itself', async () => {
  const id = await addRelationship('parent-1', 'child-1');

  const bothEnds = await putRelationship(id, { from_person_id: 'child-1', to_person_id: 'child-1' });
  assert.equal(bothEnds.status, 400);
  assert.match(await bothEnds.text(), /themselves/);

  // ...including when only one end is sent and it collides with the other.
  const oneEnd = await putRelationship(id, { from_person_id: 'child-1' });
  assert.equal(oneEnd.status, 400);

  const row = await relationshipRow(id);
  assert.equal(row.from_person_id, 'parent-1');
  assert.equal(row.to_person_id, 'child-1');
});

test('a valid repoint still works', async () => {
  const id = await addRelationship('parent-1', 'child-1');

  const response = await putRelationship(id, { to_person_id: 'child-2', skip_auto_link: true });
  assert.equal(response.status, 200);
  assert.equal((await relationshipRow(id)).to_person_id, 'child-2');
});

test('updating only the metadata needs no endpoint lookup', async () => {
  const id = await addRelationship('parent-1', 'child-1');

  const response = await putRelationship(id, { metadata: { note: 'adopted' }, skip_auto_link: true });
  assert.equal(response.status, 200);
  const row = await relationshipRow(id);
  assert.equal(row.from_person_id, 'parent-1');
  assert.equal(row.to_person_id, 'child-1');
});
