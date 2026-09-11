import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { getAllowedEmails, isEmailAuthorized, registerAuthRoutes, requireAuth } from './auth';
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
      return { run: { success: true } };
    }
    if (query.includes('SELECT COUNT(*) as count FROM users')) {
      return { first: { count: this.users.size } };
    }
    return { run: { success: true } };
  }
}

test('POST /api/auth/register respects ALLOWED_EMAILS', async () => {
  const db = new SimpleMockD1();
  const app = new Hono<AppBindings>();
  registerAuthRoutes(app);

  const env: Env = {
    DB: db as any,
    AVATARS: {} as any,
    ALLOWED_EMAILS: 'pjiaquan@gmail.com'
  };

  // Attempting to register an unauthorized email should be rejected with 403
  const rejectRes = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'stranger@example.com', password: 'Password12345!' })
  }, env);

  assert.equal(rejectRes.status, 403);
  const rejectBody = await rejectRes.json();
  assert.equal(rejectBody.error, 'Registration is restricted to authorized emails');

  // Attempting to register the allowed email should pass authorization
  const acceptRes = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pjiaquan@gmail.com', password: 'Password12345!' })
  }, env);

  assert.equal(acceptRes.status, 201);
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
  const blockedBody = await blockedRes.json();
  assert.equal(blockedBody.error, 'Account not authorized to access this database');

  // Allowed session
  const allowedRes = await app.request('/api/protected', {
    headers: { Cookie: 'clan_session=session-allowed' }
  }, env);
  assert.equal(allowedRes.status, 200);
  const allowedBody = await allowedRes.json();
  assert.equal(allowedBody.ok, true);
});
