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
 * Runs against a real SQLite database created from migrations/schema.sql, so
 * the parked-address flow is exercised end to end rather than against a mock
 * that would have to be taught the behaviour under test. Outgoing mail is
 * intercepted to recover the confirmation token.
 */
const PASSWORD = 'Correct Horse Battery Staple 9!';
const SALT = 'DEr8xCDlZ0kqK3hdMQxLsQ==';
const CURRENT_EMAIL = 'owner@example.com';
const NEW_EMAIL = 'new-owner@example.com';
const USER_ID = 'user-1';

const schemaSql = await readFile(path.resolve('migrations/schema.sql'), 'utf8');
const dir = await mkdtemp(path.join(tmpdir(), 'clan-account-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));
db.rawDb.exec(schemaSql);

const app = new Hono<AppBindings>();
app.use('/api/auth/account', async (c, next) => {
  c.set('sessionUser', { userId: USER_ID, username: CURRENT_EMAIL, email: CURRENT_EMAIL, role: 'admin' });
  await next();
});
registerAuthRoutes(app);

const baseEnv = {
  DB: db as unknown as D1Database,
  AVATARS: {} as any,
  ENVIRONMENT: 'development',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  EMAIL_VERIFICATION_URL_BASE: 'http://localhost:5173',
  BREVO_API_KEY: 'test-key',
  BREVO_FROM_EMAIL: 'no-reply@example.com',
} as Env;

type SentEmail = { to: string; subject: string; textContent: string };

/** Captures Brevo calls instead of making them, and returns what was sent. */
const withCapturedEmail = async (run: (sent: SentEmail[]) => Promise<void>) => {
  const sent: SentEmail[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? '{}'));
    sent.push({
      to: String(payload.to?.[0]?.email ?? ''),
      subject: String(payload.subject ?? ''),
      textContent: String(payload.textContent ?? ''),
    });
    return new Response('{}', { status: 201 });
  }) as typeof fetch;
  try {
    await run(sent);
  } finally {
    globalThis.fetch = original;
  }
};

const resetUser = async () => {
  const now = new Date().toISOString();
  await db.prepare('DELETE FROM users').run();
  await db.prepare(
    `INSERT INTO users (id, username, email, email_verified_at, password_hash, password_salt, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'admin', ?, ?)`
  ).bind(USER_ID, CURRENT_EMAIL, CURRENT_EMAIL, now, await hashPassword(PASSWORD, SALT), SALT, now, now).run();
};

const userRow = async () => (await db.prepare(
  'SELECT username, email, pending_email, email_verified_at, email_verify_token_hash FROM users WHERE id = ?'
).bind(USER_ID).first()) as any;

const putAccount = (body: Record<string, unknown>, env: Env = baseEnv) => app.request(
  '/api/auth/account',
  { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  env
);

const postVerifyEmail = (token: string) => app.request(
  '/api/auth/verify-email',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) },
  baseEnv
);

const tokenFromEmail = (sent: SentEmail[], recipient: string) => {
  const mail = sent.find((item) => item.to === recipient);
  assert.ok(mail, `expected a message to ${recipient}`);
  const match = mail.textContent.match(/verify_email_token=([^\s&]+)/);
  assert.ok(match, `expected a verification token in the message to ${recipient}`);
  return decodeURIComponent(match[1]);
};

test('changing the email address requires the current password', async () => {
  await resetUser();
  await withCapturedEmail(async (sent) => {
    const noPassword = await putAccount({ email: 'attacker@example.com' });
    assert.equal(noPassword.status, 400);
    assert.match(await noPassword.text(), /current_password is required/);

    const wrongPassword = await putAccount({ email: 'attacker@example.com', current_password: 'nope' });
    assert.equal(wrongPassword.status, 400);
    assert.match(await wrongPassword.text(), /Current password is incorrect/);

    // A hijacked session alone must not be able to move the address, and must
    // not be able to make the system send anything either.
    const row = await userRow();
    assert.equal(row.email, CURRENT_EMAIL);
    assert.equal(row.pending_email, null);
    assert.equal(row.email_verify_token_hash, null);
    assert.deepEqual(sent, []);
  });
});

test('a confirmed password parks the address and warns the old one', async () => {
  await resetUser();
  await withCapturedEmail(async (sent) => {
    const response = await putAccount({ email: NEW_EMAIL, current_password: PASSWORD });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).pending_email, NEW_EMAIL);

    const row = await userRow();
    // The sign-in identity has not moved, and the old address stays verified.
    assert.equal(row.username, CURRENT_EMAIL);
    assert.equal(row.email, CURRENT_EMAIL);
    assert.ok(row.email_verified_at, 'the current address must stay verified');
    assert.equal(row.pending_email, NEW_EMAIL);
    assert.ok(row.email_verify_token_hash);

    assert.ok(sent.some((item) => item.to === NEW_EMAIL), 'the new address gets a confirmation link');
    const notice = sent.find((item) => item.to === CURRENT_EMAIL);
    assert.ok(notice, 'the old address must be told');
    assert.match(notice.textContent, new RegExp(NEW_EMAIL));
  });
});

test('the address moves only once the new owner confirms it', async () => {
  await resetUser();
  await withCapturedEmail(async (sent) => {
    await putAccount({ email: NEW_EMAIL, current_password: PASSWORD });

    const wrongToken = await postVerifyEmail('not-the-token');
    assert.equal(wrongToken.status, 400);
    assert.equal((await userRow()).email, CURRENT_EMAIL, 'a bad token changes nothing');

    const confirmed = await postVerifyEmail(tokenFromEmail(sent, NEW_EMAIL));
    assert.equal(confirmed.status, 200);
    const body = await confirmed.json() as any;
    assert.equal(body.email, NEW_EMAIL);
    assert.equal(body.email_changed, true);

    const row = await userRow();
    assert.equal(row.username, NEW_EMAIL);
    assert.equal(row.email, NEW_EMAIL);
    assert.equal(row.pending_email, null);
    assert.ok(row.email_verified_at);

    // The token is single-use.
    assert.equal((await postVerifyEmail(tokenFromEmail(sent, NEW_EMAIL))).status, 400);
  });
});

test('the allowlist applies to the requested address, with no admin exemption', async () => {
  await resetUser();
  await withCapturedEmail(async () => {
    const env = { ...baseEnv, ALLOWED_EMAILS: `${CURRENT_EMAIL},family@example.com` } as Env;

    const restricted = await putAccount({ email: 'stranger@example.com', current_password: PASSWORD }, env);
    assert.equal(restricted.status, 403);
    assert.match(await restricted.text(), /not authorized/);
    assert.equal((await userRow()).pending_email, null);

    const allowed = await putAccount({ email: 'family@example.com', current_password: PASSWORD }, env);
    assert.equal(allowed.status, 200);
    assert.equal((await userRow()).pending_email, 'family@example.com');
  });
});

test('an unchanged address needs no password', async () => {
  await resetUser();
  await withCapturedEmail(async (sent) => {
    const response = await putAccount({ email: CURRENT_EMAIL });
    assert.equal(response.status, 200);
    assert.equal((await userRow()).pending_email, null);
    assert.deepEqual(sent, []);
  });
});
