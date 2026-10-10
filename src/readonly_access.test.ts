import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from './index';
import { hashPassword } from './auth';
import { SqliteD1Database } from './selfhost/sqlite_d1';
import type { Env } from './types';

/**
 * Every write outside /api/auth/* is admin-only, and that is enforced by one
 * middleware (`requireWriteAccess`) wired before the route registrations in
 * src/index.ts. Nothing checked it per route, so reordering the middleware --
 * or registering a new route under the `/api/auth/` prefix the middleware
 * exempts -- would silently open all of them.
 *
 * This drives the real `app`, with a session obtained through the real login
 * flow, so the middleware order and the CSRF check are the ones that ship.
 */
const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'Correct Horse Battery Staple 9!';
const SALT = 'DEr8xCDlZ0kqK3hdMQxLsQ==';

const schemaSql = await readFile(path.resolve('migrations/schema.sql'), 'utf8');
const dir = await mkdtemp(path.join(tmpdir(), 'clan-readonly-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));
db.rawDb.exec(schemaSql);

const env = {
  DB: db as unknown as D1Database,
  AVATARS: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  } as unknown as R2Bucket,
  ENVIRONMENT: 'development',
  FRONTEND_ORIGIN: ORIGIN,
  BREVO_API_KEY: 'test-key',
  BREVO_FROM_EMAIL: 'no-reply@example.com',
} as Env;

const addUser = async (id: string, email: string, role: 'admin' | 'readonly') => {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO users (id, username, email, email_verified_at, password_hash, password_salt, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, email, email, now, await hashPassword(PASSWORD, SALT), SALT, role, now, now).run();
};

/** Signs in through the real endpoints and returns the session cookie. */
const signIn = async (email: string) => {
  const codes: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? '{}'));
    const match = String(payload.textContent ?? '').match(/\b(\d{6})\b/);
    if (match) codes.push(match[1]);
    return new Response('{}', { status: 201 });
  }) as typeof fetch;

  try {
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password: PASSWORD }),
    }, env);
    assert.equal(login.status, 202, `login for ${email} should issue an MFA challenge`);
    const challenge = await login.json() as any;

    const verify = await app.request('/api/auth/verify-mfa', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ challenge_id: challenge.email_challenge_id, code: codes[0] }),
    }, env);
    assert.equal(verify.status, 200, `MFA verification for ${email} should succeed`);

    const setCookie = verify.headers.get('set-cookie') ?? '';
    const token = /clan_session=([^;]+)/.exec(setCookie)?.[1];
    assert.ok(token, 'a session cookie should be issued');
    return `clan_session=${token}`;
  } finally {
    globalThis.fetch = originalFetch;
  }
};

await addUser('user-readonly', 'readonly@example.com', 'readonly');
await addUser('user-admin', 'admin@example.com', 'admin');
const readonlyCookie = await signIn('readonly@example.com');

type Route = { method: string; path: string; body?: unknown };

/** Every write route outside /api/auth/*, gated by `requireWriteAccess`. */
const MIDDLEWARE_GATED: Route[] = [
  { method: 'POST', path: '/api/people', body: { name: 'Intruder' } },
  { method: 'PUT', path: '/api/people/person-1', body: { name: 'Renamed' } },
  { method: 'DELETE', path: '/api/people/person-1' },
  { method: 'POST', path: '/api/people/person-1/avatar' },
  { method: 'POST', path: '/api/people/person-1/avatars' },
  { method: 'PUT', path: '/api/people/person-1/avatars/avatar-1', body: { is_primary: true } },
  { method: 'DELETE', path: '/api/people/person-1/avatars/avatar-1' },
  { method: 'POST', path: '/api/relationships', body: { from_person_id: 'a', to_person_id: 'b', type: 'spouse' } },
  { method: 'PUT', path: '/api/relationships/1', body: { type: 'spouse' } },
  { method: 'DELETE', path: '/api/relationships/1' },
  { method: 'POST', path: '/api/layers', body: { name: 'New layer' } },
  { method: 'DELETE', path: '/api/layers/default' },
  { method: 'POST', path: '/api/notifications', body: { type: 'other', message: 'x' } },
  { method: 'PUT', path: '/api/notifications/1', body: { status: 'resolved' } },
  { method: 'DELETE', path: '/api/notifications/1' },
  { method: 'POST', path: '/api/admin/backup/import', body: { confirmation_text: 'DELETE' } },
  { method: 'PUT', path: '/api/kinship-labels', body: {} },
  { method: 'POST', path: '/api/kinship-labels/reset' },
  { method: 'PUT', path: '/api/relationship-type-labels/spouse', body: { label: 'x' } },
  { method: 'POST', path: '/api/relationship-type-labels/reset' },
];

/**
 * Admin-only routes under the `/api/auth/` prefix, which `requireWriteAccess`
 * exempts, so each carries its own check. They are listed here so the
 * exemption cannot quietly become a hole.
 */
const HANDLER_GATED: Route[] = [
  { method: 'POST', path: '/api/auth/users', body: { email: 'new@example.com', role: 'admin' } },
  { method: 'PUT', path: '/api/auth/users/user-admin', body: { role: 'readonly' } },
  { method: 'DELETE', path: '/api/auth/users/user-admin' },
];

/** Admin-only reads. */
const ADMIN_READS: Route[] = [
  { method: 'GET', path: '/api/audit-logs' },
  { method: 'GET', path: '/api/admin/backup/export' },
  { method: 'GET', path: '/api/notifications' },
  { method: 'GET', path: '/api/notifications/stats' },
];

const send = (route: Route, cookie: string) => app.request(route.path, {
  method: route.method,
  headers: {
    cookie,
    origin: ORIGIN,
    ...(route.body === undefined ? {} : { 'content-type': 'application/json' }),
  },
  ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
}, env);

test('a read-only session is refused by every middleware-gated write route', async () => {
  for (const route of MIDDLEWARE_GATED) {
    const res = await send(route, readonlyCookie);
    assert.equal(res.status, 403, `${route.method} ${route.path} should be 403`);
    const body = await res.json() as { error: string };
    // Specifically the role gate -- not the CSRF check, which also answers 403.
    assert.equal(
      body.error,
      'Read-only account',
      `${route.method} ${route.path} should be refused by requireWriteAccess`
    );
  }
});

test('a read-only session is refused by every handler-gated admin route', async () => {
  for (const route of [...HANDLER_GATED, ...ADMIN_READS]) {
    const res = await send(route, readonlyCookie);
    assert.equal(res.status, 403, `${route.method} ${route.path} should be 403`);
  }
});

test('the refusal is about the role, not a missing session or origin', async () => {
  // The same session may read the graph, so it is a valid, authenticated one.
  const read = await send({ method: 'GET', path: '/api/people' }, readonlyCookie);
  assert.equal(read.status, 200, 'a read-only session can still read');

  // An admin session is not refused by the same gate, so the suite is
  // exercising the role check rather than something incidental.
  const adminCookie = await signIn('admin@example.com');
  const asAdmin = await send({ method: 'POST', path: '/api/layers', body: { name: 'Admin layer' } }, adminCookie);
  assert.notEqual(asAdmin.status, 403, 'an admin must not be refused by the role gate');
});

test('no session at all is rejected before the role gate', async () => {
  const res = await send({ method: 'POST', path: '/api/people', body: { name: 'Anonymous' } }, '');
  assert.equal(res.status, 401);
});
