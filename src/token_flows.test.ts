import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { hashPassword, registerAuthRoutes, requireAuth, verifyPassword } from './auth';
import { SqliteD1Database } from './selfhost/sqlite_d1';
import type { AppBindings, Env } from './types';

/**
 * The password-reset and invitation flows had no test coverage, although they
 * are the two paths that can hand control of an account to whoever holds a
 * single-use token.
 */
const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'Correct Horse Battery Staple 9!';
const NEW_PASSWORD = 'Entirely Different Phrase 7!';
const SALT = 'DEr8xCDlZ0kqK3hdMQxLsQ==';
const MEMBER_EMAIL = 'member@example.com';

const schemaSql = await readFile(path.resolve('migrations/schema.sql'), 'utf8');
const dir = await mkdtemp(path.join(tmpdir(), 'clan-tokens-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));
db.rawDb.exec(schemaSql);

// Mounted as in src/index.ts, so admin-only routes see a real session.
const app = new Hono<AppBindings>();
app.use('/api/*', requireAuth);
registerAuthRoutes(app);

const env = {
  DB: db as unknown as D1Database,
  AVATARS: {} as any,
  ENVIRONMENT: 'development',
  FRONTEND_ORIGIN: ORIGIN,
  PASSWORD_RESET_URL_BASE: ORIGIN,
  EMAIL_VERIFICATION_URL_BASE: ORIGIN,
  BREVO_API_KEY: 'test-key',
  BREVO_FROM_EMAIL: 'no-reply@example.com',
} as Env;

type SentEmail = { to: string; textContent: string };

const withCapturedEmail = async (run: (sent: SentEmail[]) => Promise<void>) => {
  const sent: SentEmail[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? '{}'));
    sent.push({ to: String(payload.to?.[0]?.email ?? ''), textContent: String(payload.textContent ?? '') });
    return new Response('{}', { status: 201 });
  }) as typeof fetch;
  try {
    await run(sent);
  } finally {
    globalThis.fetch = original;
  }
};

const post = (url: string, body: Record<string, unknown>, cookie?: string) => app.request(
  url,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  },
  env
);

/** Seeds a live session for the admin and returns the cookie that carries it. */
const adminSessionCookie = async () => {
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('admin-session', 'user-admin', ?, ?)"
  ).bind(now, new Date(Date.now() + 3600_000).toISOString()).run();
  return 'clan_session=admin-session';
};

const tokenFrom = (sent: SentEmail[], to: string, param: string) => {
  const mail = sent.filter((item) => item.to === to).pop();
  assert.ok(mail, `expected a message to ${to}`);
  const match = mail.textContent.match(new RegExp(`${param}=([^\\s&]+)`));
  assert.ok(match, `expected a ${param} in the message to ${to}`);
  return decodeURIComponent(match[1]);
};

const resetState = async () => {
  const now = new Date().toISOString();
  for (const table of ['password_reset_tokens', 'sessions', 'auth_rate_limits', 'users']) {
    await db.prepare(`DELETE FROM ${table}`).run().catch(() => undefined);
  }
  await db.prepare(
    `INSERT INTO users (id, username, email, email_verified_at, password_hash, password_salt, role, created_at, updated_at)
     VALUES ('user-admin', 'admin@example.com', 'admin@example.com', ?, ?, ?, 'admin', ?, ?)`
  ).bind(now, await hashPassword(PASSWORD, SALT), SALT, now, now).run();
  await db.prepare(
    `INSERT INTO users (id, username, email, email_verified_at, password_hash, password_salt, role, created_at, updated_at)
     VALUES ('user-member', ?, ?, ?, ?, ?, 'readonly', ?, ?)`
  ).bind(MEMBER_EMAIL, MEMBER_EMAIL, now, await hashPassword(PASSWORD, SALT), SALT, now, now).run();
};

const storedPassword = async (id: string) => (await db.prepare(
  'SELECT password_hash, password_salt FROM users WHERE id = ?'
).bind(id).first()) as any;

test('a reset token replaces the password, once, and revokes sessions', async () => {
  await resetState();
  await db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('s1', 'user-member', ?, ?)"
  ).bind(new Date().toISOString(), new Date(Date.now() + 3600_000).toISOString()).run();

  await withCapturedEmail(async (sent) => {
    assert.equal((await post('/api/auth/forgot-password', { email: MEMBER_EMAIL })).status, 200);
    const token = tokenFrom(sent, MEMBER_EMAIL, 'reset_password_token');

    const reset = await post('/api/auth/reset-password', { token, password: NEW_PASSWORD });
    assert.equal(reset.status, 200);

    const stored = await storedPassword('user-member');
    assert.equal((await verifyPassword(NEW_PASSWORD, stored.password_salt, stored.password_hash)).ok, true);
    assert.equal((await verifyPassword(PASSWORD, stored.password_salt, stored.password_hash)).ok, false);

    const sessions = await db.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'user-member'"
    ).first() as any;
    assert.equal(Number(sessions.count), 0, 'existing sessions must not survive a reset');

    // Single use.
    const replay = await post('/api/auth/reset-password', { token, password: 'Yet Another Phrase 5!' });
    assert.notEqual(replay.status, 200);
    const afterReplay = await storedPassword('user-member');
    assert.equal(afterReplay.password_hash, stored.password_hash, 'a replay must not change the password');
  });
});

test('an expired reset token is refused', async () => {
  await resetState();
  await withCapturedEmail(async (sent) => {
    await post('/api/auth/forgot-password', { email: MEMBER_EMAIL });
    const token = tokenFrom(sent, MEMBER_EMAIL, 'reset_password_token');
    const before = await storedPassword('user-member');

    await db.prepare(
      "UPDATE password_reset_tokens SET expires_at = ? WHERE user_id = 'user-member'"
    ).bind(new Date(Date.now() - 1000).toISOString()).run();

    assert.notEqual((await post('/api/auth/reset-password', { token, password: NEW_PASSWORD })).status, 200);
    assert.equal((await storedPassword('user-member')).password_hash, before.password_hash);
  });
});

test('forgot-password does not reveal whether an address exists', async () => {
  await resetState();
  await withCapturedEmail(async (sent) => {
    const known = await post('/api/auth/forgot-password', { email: MEMBER_EMAIL });
    const unknown = await post('/api/auth/forgot-password', { email: 'nobody@example.com' });

    assert.equal(known.status, unknown.status);
    assert.deepEqual(await known.json(), await unknown.json());
    // ...and nothing is sent to the address that does not exist.
    assert.equal(sent.some((item) => item.to === 'nobody@example.com'), false);
  });
});

test('an invitation token sets the password and activates the account', async () => {
  await resetState();
  await withCapturedEmail(async (sent) => {
    const invited = 'invited@example.com';
    const create = await post('/api/auth/users', { email: invited, role: 'readonly' }, await adminSessionCookie());
    assert.equal(create.status, 201);

    // Before the invitation is accepted the account cannot be signed in to.
    const earlyLogin = await post('/api/auth/login', { email: invited, password: PASSWORD });
    assert.equal(earlyLogin.status, 401);

    const token = tokenFrom(sent, invited, 'invite_token');
    const accept = await post('/api/auth/accept-invite', { token, password: NEW_PASSWORD });
    assert.equal(accept.status, 200);

    const row = await db.prepare(
      'SELECT id, password_hash, password_salt, email_verified_at, role FROM users WHERE email = ?'
    ).bind(invited).first() as any;
    assert.equal((await verifyPassword(NEW_PASSWORD, row.password_salt, row.password_hash)).ok, true);
    assert.ok(row.email_verified_at, 'accepting an invitation verifies the address');
    assert.equal(row.role, 'readonly', 'the invited role is not escalated');

    // Single use.
    assert.notEqual((await post('/api/auth/accept-invite', { token, password: 'Third Phrase Entirely 3!' })).status, 200);
  });
});

test('a forged or mangled token is refused by both flows', async () => {
  await resetState();
  for (const token of ['not-a-real-token', 'x'.repeat(64), '0']) {
    assert.notEqual((await post('/api/auth/reset-password', { token, password: NEW_PASSWORD })).status, 200);
    assert.notEqual((await post('/api/auth/accept-invite', { token, password: NEW_PASSWORD })).status, 200);
  }
  const stored = await storedPassword('user-member');
  assert.equal((await verifyPassword(PASSWORD, stored.password_salt, stored.password_hash)).ok, true);
});
