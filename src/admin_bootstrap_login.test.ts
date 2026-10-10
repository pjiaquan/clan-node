import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { hashPassword, registerAuthRoutes } from './auth';
import { SqliteD1Database } from './selfhost/sqlite_d1';
import type { AppBindings, Env } from './types';

/**
 * The first admin is created by /api/auth/setup, which leaves no session, and
 * TOTP can only be enrolled from one. The e-mail code was refused at both
 * send and verify for any admin, so that account could never sign in. These
 * tests pin the narrow bootstrap exemption and the fact that it closes again.
 */
const PASSWORD = 'Correct Horse Battery Staple 9!';
const SALT = 'DEr8xCDlZ0kqK3hdMQxLsQ==';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_ID = 'user-admin';

const schemaSql = await readFile(path.resolve('migrations/schema.sql'), 'utf8');
const dir = await mkdtemp(path.join(tmpdir(), 'clan-bootstrap-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));
db.rawDb.exec(schemaSql);

const app = new Hono<AppBindings>();
registerAuthRoutes(app);

const env = {
  DB: db as unknown as D1Database,
  AVATARS: {} as any,
  ENVIRONMENT: 'development',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  BREVO_API_KEY: 'test-key',
  BREVO_FROM_EMAIL: 'no-reply@example.com',
} as Env;

/** Captures the sign-in code out of the Brevo payload. */
const withCapturedCode = async (run: (codes: string[]) => Promise<void>) => {
  const codes: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? '{}'));
    const match = String(payload.textContent ?? '').match(/\b(\d{6})\b/);
    if (match) codes.push(match[1]);
    return new Response('{}', { status: 201 });
  }) as typeof fetch;
  try {
    await run(codes);
  } finally {
    globalThis.fetch = original;
  }
};

const resetAdmin = async () => {
  const now = new Date().toISOString();
  await db.prepare('DELETE FROM sessions').run();
  await db.prepare('DELETE FROM users').run();
  await db.prepare('DELETE FROM auth_rate_limits').run().catch(() => undefined);
  await db.prepare('DELETE FROM auth_mfa_sessions').run().catch(() => undefined);
  await db.prepare('DELETE FROM auth_mfa_challenges').run().catch(() => undefined);
  await db.prepare(
    `INSERT INTO users (id, username, email, email_verified_at, password_hash, password_salt, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'admin', ?, ?)`
  ).bind(ADMIN_ID, ADMIN_EMAIL, ADMIN_EMAIL, now, await hashPassword(PASSWORD, SALT), SALT, now, now).run();
};

const postJson = (url: string, body: Record<string, unknown>) => app.request(
  url,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  env
);

const login = () => postJson('/api/auth/login', { email: ADMIN_EMAIL, password: PASSWORD });

test('the first admin can sign in with an emailed code', async () => {
  await resetAdmin();
  await withCapturedCode(async (codes) => {
    const loginResponse = await login();
    assert.equal(loginResponse.status, 202, 'an MFA challenge is a 202');
    const challenge = await loginResponse.json() as any;
    assert.equal(challenge.mfa_required, true);
    assert.ok(challenge.email_challenge_id, 'an email challenge should be issued');
    assert.equal(codes.length, 1, 'a code should have been sent');

    const verify = await postJson('/api/auth/verify-mfa', {
      challenge_id: challenge.email_challenge_id,
      code: codes[0],
    });
    assert.equal(verify.status, 200);
    const verified = await verify.json() as any;
    assert.equal(verified.user.id, ADMIN_ID);
    // The session just created is the only chance to enrol TOTP.
    assert.equal(verified.requires_totp_enrollment, true);

    const sessions = await db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .bind(ADMIN_ID).first() as any;
    assert.equal(Number(sessions.count), 1);
  });
});

test('the exemption closes once the admin has a session', async () => {
  await resetAdmin();
  await withCapturedCode(async (codes) => {
    const first = await login();
    const challenge = await first.json() as any;
    const verify = await postJson('/api/auth/verify-mfa', {
      challenge_id: challenge.email_challenge_id,
      code: codes[0],
    });
    assert.equal(verify.status, 200);

    // A second sign-in attempt now hits the mandatory-TOTP policy, because the
    // account has session history. It must not fall back to an e-mail code.
    const second = await login();
    assert.equal(second.status, 403);
    assert.match(await second.text(), /require authenticator app MFA/);
  });
});

test('an admin with session history cannot request an email code', async () => {
  await resetAdmin();
  await withCapturedCode(async () => {
    // A normal second sign-in is refused before an MFA session even exists, so
    // build the state directly to check the send-email gate itself rather than
    // relying on the login path to be the only way in.
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.prepare(
      'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).bind('old-session', ADMIN_ID, now, later).run();
    await db.prepare(
      `INSERT INTO auth_mfa_sessions (id, user_id, email, expires_at, attempt_count, max_attempts, created_at)
       VALUES (?, ?, ?, ?, 0, 5, ?)`
    ).bind('mfa-session', ADMIN_ID, ADMIN_EMAIL, later, now).run();

    const sendEmail = await postJson('/api/auth/mfa/send-email', { session_id: 'mfa-session' });
    assert.equal(sendEmail.status, 403);
    assert.match(await sendEmail.text(), /must use authenticator app MFA/);
  });
});

test('a wrong code does not sign the first admin in', async () => {
  await resetAdmin();
  await withCapturedCode(async (codes) => {
    const loginResponse = await login();
    const challenge = await loginResponse.json() as any;

    const wrong = await postJson('/api/auth/verify-mfa', {
      challenge_id: challenge.email_challenge_id,
      code: codes[0] === '000000' ? '111111' : '000000',
    });
    assert.equal(wrong.status, 401);

    const sessions = await db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .bind(ADMIN_ID).first() as any;
    assert.equal(Number(sessions.count), 0);
  });
});
