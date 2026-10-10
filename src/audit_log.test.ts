import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { recordAuditLog, registerAuditRoutes, requireAuditLog } from './audit';
import { SqliteD1Database } from './selfhost/sqlite_d1';
import type { AppBindings, Env } from './types';

const schemaSql = await readFile(path.resolve('migrations/schema.sql'), 'utf8');
const dir = await mkdtemp(path.join(tmpdir(), 'clan-audit-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));
db.rawDb.exec(schemaSql);
await db.prepare(
  `INSERT INTO users (id, username, email, password_hash, password_salt, role)
   VALUES ('user-1', 'admin@example.com', 'admin@example.com', 'x', 'y', 'admin')`
).run();

const app = new Hono<AppBindings>();
app.use('*', async (c, next) => {
  c.set('sessionUser', { userId: 'user-1', username: 'admin@example.com', role: 'admin' });
  await next();
});
registerAuditRoutes(app);
// Probes for the write helpers, so they run with a real context.
app.post('/test/record', async (c) => {
  await recordAuditLog(c, { action: 'probe_optional', resourceType: 'test' });
  return c.json({ ok: true });
});
app.post('/test/require', async (c) => {
  const failure = await requireAuditLog(c, { action: 'probe_required', resourceType: 'test' });
  if (failure) return failure;
  return c.json({ ok: true });
});

const env = { DB: db as unknown as D1Database, AVATARS: {} as any, ENVIRONMENT: 'development' } as Env;

const fetchLogs = async (query = '') => {
  const res = await app.request(`/api/audit-logs${query}`, {}, env);
  assert.equal(res.status, 200);
  return await res.json() as Array<{ id: number; action: string }>;
};

test('entries older than one page are reachable with a cursor', async () => {
  for (let i = 0; i < 12; i += 1) {
    await db.prepare(
      `INSERT INTO audit_logs (actor_user_id, actor_username, actor_role, action, resource_type, created_at)
       VALUES ('user-1', 'admin@example.com', 'admin', ?, 'test', ?)`
      // A shared created_at: ordering must not depend on it being unique.
    ).bind(`action-${i}`, '2026-01-01T00:00:00.000Z').run();
  }

  const firstPage = await fetchLogs('?limit=5');
  assert.equal(firstPage.length, 5);
  assert.deepEqual(
    firstPage.map((row) => row.action),
    ['action-11', 'action-10', 'action-9', 'action-8', 'action-7'],
    'newest first, by id'
  );

  const secondPage = await fetchLogs(`?limit=5&before=${firstPage[firstPage.length - 1].id}`);
  assert.deepEqual(
    secondPage.map((row) => row.action),
    ['action-6', 'action-5', 'action-4', 'action-3', 'action-2'],
    'the cursor continues where the first page ended, with no overlap'
  );

  const thirdPage = await fetchLogs(`?limit=5&before=${secondPage[secondPage.length - 1].id}`);
  assert.deepEqual(thirdPage.map((row) => row.action), ['action-1', 'action-0']);

  // Walking off the end is empty, not an error.
  assert.deepEqual(await fetchLogs(`?limit=5&before=${thirdPage[thirdPage.length - 1].id}`), []);
  // A junk cursor is ignored rather than crashing.
  assert.equal((await fetchLogs('?limit=5&before=not-a-number')).length, 5);
});

test('an optional audit write that fails does not fail its request', async () => {
  const broken = new SqliteD1Database(path.join(dir, 'broken.sqlite'));
  broken.rawDb.exec('CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, wrong_shape TEXT NOT NULL)');
  const brokenEnv = { ...env, DB: broken as unknown as D1Database } as Env;

  const res = await app.request('/test/record', { method: 'POST' }, brokenEnv);
  assert.equal(res.status, 200, 'a mutation must not fail over its own log line');
});

test('a required audit write that fails stops the operation', async () => {
  const broken = new SqliteD1Database(path.join(dir, 'broken2.sqlite'));
  broken.rawDb.exec('CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, wrong_shape TEXT NOT NULL)');
  const brokenEnv = { ...env, DB: broken as unknown as D1Database } as Env;

  const res = await app.request('/test/require', { method: 'POST' }, brokenEnv);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /was not performed/);
});

test('a required audit write succeeds normally', async () => {
  const res = await app.request('/test/require', { method: 'POST' }, env);
  assert.equal(res.status, 200);

  const stored = await db.prepare(
    "SELECT action, actor_username FROM audit_logs WHERE action = 'probe_required'"
  ).first() as any;
  assert.equal(stored.action, 'probe_required');
  assert.equal(stored.actor_username, 'admin@example.com', 'the actor comes from the session, not the body');
});
