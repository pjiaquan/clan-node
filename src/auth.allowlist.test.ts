import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { getAllowedEmails, isEmailAuthorized, isUsableSetupToken, registerAuthRoutes, requireAuth } from './auth';
import type { AppBindings, Env } from './types';

test('getAllowedEmails parses various formats and handles empty cases', () => {
  assert.equal(getAllowedEmails(undefined), null);
  assert.equal(getAllowedEmails({} as Env), null);
  assert.equal(getAllowedEmails({ ALLOWED_EMAILS: '' } as Env), null);
  assert.equal(getAllowedEmails({ ALLOWED_EMAILS: '   ' } as Env), null);

  const parsed = getAllowedEmails({
    ALLOWED_EMAILS: 'user1@example.com, user2@example.com; USER3@EXAMPLE.COM\nuser4@example.com'
  } as Env);

  assert.ok(parsed);
  assert.equal(parsed.size, 4);
  assert.ok(parsed.has('user1@example.com'));
  assert.ok(parsed.has('user2@example.com'));
  assert.ok(parsed.has('user3@example.com'));
  assert.ok(parsed.has('user4@example.com'));
});

test('isEmailAuthorized handles admin exemption and allowlist checks', () => {
  const envWithWhitelist = {
    ALLOWED_EMAILS: 'pjiaquan@gmail.com, family@example.com'
  } as Env;

  // Admins are always authorized
  assert.equal(isEmailAuthorized('stranger@example.com', envWithWhitelist, 'admin'), true);

  // If no allowlist configured, everyone is authorized
  assert.equal(isEmailAuthorized('stranger@example.com', {} as Env, 'readonly'), true);

  // In allowlist (case-insensitive)
  assert.equal(isEmailAuthorized('PJIAQUAN@GMAIL.COM', envWithWhitelist, 'readonly'), true);
  assert.equal(isEmailAuthorized('family@example.com', envWithWhitelist, 'readonly'), true);

  // Not in allowlist
  assert.equal(isEmailAuthorized('stranger@example.com', envWithWhitelist, 'readonly'), false);
  assert.equal(isEmailAuthorized('stranger@example.com', envWithWhitelist), false);
});

type MockStatementResult = {
  results?: Array<Record<string, unknown>>;
  first?: Record<string, unknown> | null;
  run?: { success: boolean; meta?: Record<string, unknown> };
};

class SimpleMockD1 {
  insertedUsers: Array<Record<string, unknown>> = [];

  users = new Map<string, Record<string, unknown>>();
  sessions = new Map<string, Record<string, unknown>>();

  prepare(query: string) {
    const db = this;
    const buildRunner = (args: unknown[]) => ({
      async first() {
        return db.handle(query, args).first ?? null;
      },
      async run() {
        return db.handle(query, args).run ?? { success: true, meta: {} };
      },
      async all() {
        return { results: db.handle(query, args).results ?? [] };
      }
    });

    return {
      first() { return buildRunner([]).first(); },
      run() { return buildRunner([]).run(); },
      all() { return buildRunner([]).all(); },
      bind(...args: unknown[]) { return buildRunner(args); }
    };
  }

  private handle(query: string, args: unknown[]): MockStatementResult {
    if (
      query.startsWith('CREATE TABLE IF NOT EXISTS')
      || query.startsWith('CREATE UNIQUE INDEX IF NOT EXISTS')
      || query.startsWith('CREATE INDEX IF NOT EXISTS')
      || query.startsWith('ALTER TABLE ')
    ) {
      return { run: { success: true } };
    }
    if (query.includes("PRAGMA table_info('users')")) {
      return {
        results: [
          { name: 'id' },
          { name: 'username' },
          { name: 'email' },
          { name: 'email_verified_at' },
          { name: 'email_verify_token_hash' },
          { name: 'email_verify_expires_at' },
          { name: 'role' },
          { name: 'created_at' },
          { name: 'updated_at' }
        ]
      };
    }
    if (query.includes("PRAGMA table_info('sessions')")) {
      return {
        results: [
          { name: 'id' },
          { name: 'user_id' },
          { name: 'expires_at' },
          { name: 'created_at' }
        ]
      };
    }
    if (query.includes('FROM rate_limits') || query.includes('INSERT INTO rate_limits')) {
      return { run: { success: true } };
    }
    if (query.includes('FROM users WHERE') && query.includes('SELECT id, username')) {
      const email = String(args[0]).toLowerCase();
      for (const user of this.users.values()) {
        if (String(user.email).toLowerCase() === email || String(user.username).toLowerCase() === email) {
          return { first: user };
        }
      }
      return { first: null };
    }
    if (query.includes('FROM users WHERE email = ?') || query.includes('FROM users WHERE username = ?')) {
      const email = String(args[0]).toLowerCase();
      for (const user of this.users.values()) {
        if (String(user.email).toLowerCase() === email || String(user.username).toLowerCase() === email) {
          return { first: user };
        }
      }
      return { first: null };
    }
    if (query.includes('SELECT s.id as session_id')) {
      const sessionId = String(args[0]);
      const session = this.sessions.get(sessionId);
      if (session) {
        const user = this.users.get(String(session.user_id));
        if (user) {
          return {
            first: {
              session_id: session.id,
              user_id: user.id,
              username: user.username,
              email: user.email,
              role: user.role,
              created_at: session.created_at,
              expires_at: session.expires_at,
              last_seen_at: null
            }
          };
        }
      }
      return { first: null };
    }
    if (query.includes('DELETE FROM sessions WHERE id = ?')) {
      this.sessions.delete(String(args[0]));
      return { run: { success: true } };
    }
    if (query.includes('INSERT INTO users')) {
      const columns = query.slice(query.indexOf('(') + 1, query.indexOf(')'))
        .split(',')
        .map((column) => column.trim());
      this.insertedUsers.push(Object.fromEntries(columns.map((column, index) => [column, args[index]])));
      return { run: { success: true } };
    }
    if (query.includes('SELECT COUNT(*) as count FROM users')) {
      return { first: { count: this.users.size } };
    }
    return { run: { success: true } };
  }
}

const registrationEnv = (db: SimpleMockD1, overrides: Partial<Env> = {}): Env => ({
  DB: db as any,
  AVATARS: {} as any,
  ALLOWED_EMAILS: 'pjiaquan@gmail.com',
  PUBLIC_REGISTRATION_ENABLED: '1',
  BREVO_API_KEY: 'test-key',
  BREVO_FROM_EMAIL: 'no-reply@example.com',
  ...overrides
});

const postRegister = (app: Hono<AppBindings>, env: Env, email: string) => app.request(
  '/api/auth/register',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password12345!' })
  },
  env
);

/** Keeps the Brevo delivery attempt off the network. */
const withStubbedFetch = async (run: () => Promise<void>) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 201 })) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
};

test('POST /api/auth/register is disabled unless explicitly enabled', async () => {
  const db = new SimpleMockD1();
  const app = new Hono<AppBindings>();
  registerAuthRoutes(app);

  const res = await postRegister(app, registrationEnv(db, { PUBLIC_REGISTRATION_ENABLED: undefined }), 'pjiaquan@gmail.com');
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as Record<string, unknown>).error, 'Registration is disabled');
  assert.deepEqual(db.insertedUsers, []);
});

test('POST /api/auth/register refuses to run without an allowlist or e-mail delivery', async () => {
  const app = new Hono<AppBindings>();
  registerAuthRoutes(app);

  // An unset ALLOWED_EMAILS means "no restriction", which would make an
  // enabled registration endpoint open to anyone.
  const noAllowlist = new SimpleMockD1();
  const res = await postRegister(app, registrationEnv(noAllowlist, { ALLOWED_EMAILS: undefined }), 'stranger@example.com');
  assert.equal(res.status, 503);
  assert.deepEqual(noAllowlist.insertedUsers, []);

  // Without working e-mail the account would have been created pre-verified.
  const noEmail = new SimpleMockD1();
  const res2 = await postRegister(app, registrationEnv(noEmail, { BREVO_API_KEY: undefined }), 'pjiaquan@gmail.com');
  assert.equal(res2.status, 503);
  assert.deepEqual(noEmail.insertedUsers, []);
});

test('POST /api/auth/register respects ALLOWED_EMAILS', async () => {
  await withStubbedFetch(async () => {
    const db = new SimpleMockD1();
    const app = new Hono<AppBindings>();
    registerAuthRoutes(app);
    const env = registrationEnv(db);

    // Attempting to register an unauthorized email should be rejected with 403
    const rejectRes = await postRegister(app, env, 'stranger@example.com');
    assert.equal(rejectRes.status, 403);
    const rejectBody = (await rejectRes.json()) as Record<string, unknown>;
    assert.equal(rejectBody.error, 'Registration is restricted to authorized emails');

    // Attempting to register the allowed email should pass authorization
    const acceptRes = await postRegister(app, env, 'pjiaquan@gmail.com');
    assert.equal(acceptRes.status, 201);
  });
});

test('POST /api/auth/register never grants admin, even on an empty users table', async () => {
  await withStubbedFetch(async () => {
    const db = new SimpleMockD1();
    const app = new Hono<AppBindings>();
    registerAuthRoutes(app);
    assert.equal(db.users.size, 0, 'precondition: no users exist yet');

    const res = await postRegister(app, registrationEnv(db), 'pjiaquan@gmail.com');
    assert.equal(res.status, 201);

    assert.equal(db.insertedUsers.length, 1);
    const inserted = db.insertedUsers[0];
    // The first registrant used to be given 'admin', bypassing the
    // ADMIN_SETUP_TOKEN gate on /api/auth/setup.
    assert.equal(inserted.role, 'readonly');
    // And used to be exempt from e-mail verification.
    assert.equal(inserted.email_verified_at, null);
    assert.ok(inserted.email_verify_token_hash, 'a verification token should be stored');

    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.role, 'readonly');
    assert.equal(body.email_verified, false);
  });
});

test('isUsableSetupToken rejects the shipped placeholder and short tokens', () => {
  assert.equal(isUsableSetupToken('<INSERT_RANDOM_TOKEN>'), false);
  assert.equal(isUsableSetupToken('short'), false);
  assert.equal(isUsableSetupToken('changeme-please'), false);
  assert.equal(isUsableSetupToken('f'.repeat(32)), true);
});

test('requireAuth rejects active sessions for non-authorized non-admin emails', async () => {
  const db = new SimpleMockD1();
  db.users.set('user-blocked', {
    id: 'user-blocked',
    username: 'blocked@example.com',
    email: 'blocked@example.com',
    role: 'readonly'
  });
  db.sessions.set('session-blocked', {
    id: 'session-blocked',
    user_id: 'user-blocked',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 100000).toISOString()
  });

  db.users.set('user-allowed', {
    id: 'user-allowed',
    username: 'pjiaquan@gmail.com',
    email: 'pjiaquan@gmail.com',
    role: 'readonly'
  });
  db.sessions.set('session-allowed', {
    id: 'session-allowed',
    user_id: 'user-allowed',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 100000).toISOString()
  });

  const app = new Hono<AppBindings>();
  app.use('/api/*', requireAuth);
  app.get('/api/protected', (c) => c.json({ ok: true }));

  const env: Env = {
    DB: db as any,
    AVATARS: {} as any,
    ALLOWED_EMAILS: 'pjiaquan@gmail.com'
  };

  // Blocked session
  const blockedRes = await app.request('/api/protected', {
    headers: { Cookie: 'clan_session=session-blocked' }
  }, env);
  assert.equal(blockedRes.status, 403);
  const blockedBody = (await blockedRes.json()) as Record<string, unknown>;
  assert.equal(blockedBody.error, 'Account not authorized to access this database');

  // Allowed session
  const allowedRes = await app.request('/api/protected', {
    headers: { Cookie: 'clan_session=session-allowed' }
  }, env);
  assert.equal(allowedRes.status, 200);
  const allowedBody = (await allowedRes.json()) as Record<string, unknown>;
  assert.equal(allowedBody.ok, true);
});
