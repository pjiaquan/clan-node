import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { registerAuthRoutes } from './auth';
import type { AppBindings } from './types';

type MockStatementResult = {
  results?: Array<Record<string, unknown>>;
  first?: Record<string, unknown> | null;
  run?: { success: boolean; meta?: Record<string, unknown> };
};

type RateLimitRow = {
  window_start_ms: number;
  count: number;
  blocked_until_ms: number | null;
};

type PasskeyRow = {
  id: string;
  user_id: string;
  credential_id: string;
  credential_public_key: string;
  algorithm: number;
  counter: number;
  device_type: string;
  backup_eligible: number;
  backup_state: number;
  name: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

class MockD1Database {
  auditRows: Array<Record<string, unknown>> = [];
  rateLimits = new Map<string, RateLimitRow>();
  passkeys = new Map<string, PasskeyRow>();
  sessions: Array<Record<string, unknown>> = [];
  users = new Map<string, Record<string, unknown>>([
    ['user-1', {
      id: 'user-1',
      username: 'admin@example.com',
      email: 'admin@example.com',
      email_verified_at: '2026-01-01T00:00:00.000Z',
      role: 'admin',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }]
  ]);

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
      first() {
        return buildRunner([]).first();
      },
      run() {
        return buildRunner([]).run();
      },
      all() {
        return buildRunner([]).all();
      },
      bind(...args: unknown[]) {
        return buildRunner(args);
      }
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
    if (query.includes("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_logs'")) {
      return { first: { name: 'audit_logs' } };
    }
    if (query.includes('INSERT INTO audit_logs')) {
      this.auditRows.push({
        actor_user_id: args[0],
        actor_username: args[1],
        action: args[3],
        resource_type: args[4],
        resource_id: args[5],
        summary: args[6],
        details: args[7]
      });
      return { run: { success: true, meta: { changes: 1 } } };
    }
    if (query.includes("PRAGMA table_info('users')")) {
      return {
        results: [
          { name: 'id' },
          { name: 'username' },
          { name: 'email' },
          { name: 'email_verified_at' },
          { name: 'avatar_url' },
          { name: 'role' },
          { name: 'created_at' },
          { name: 'updated_at' }
        ]
      };
    }
    if (query.includes("PRAGMA table_info('people')")) {
      return { results: [{ name: 'id' }, { name: 'email' }] };
    }
    if (query.includes("PRAGMA table_info('sessions')")) {
      return {
        results: [
          { name: 'id' },
          { name: 'user_id' },
          { name: 'created_at' },
          { name: 'expires_at' },
          { name: 'user_agent' },
          { name: 'ip_address' },
          { name: 'last_seen_at' }
        ]
      };
    }
    if (query.startsWith('UPDATE users SET email = LOWER(TRIM(username))')) {
      return { run: { success: true, meta: { changes: 0 } } };
    }
    if (query.includes('SELECT window_start_ms, count, blocked_until_ms')) {
      const key = `${args[0]}::${args[1]}`;
      return { first: this.rateLimits.get(key) ?? null };
    }
    if (query.includes('INSERT INTO auth_rate_limits')) {
      const key = `${args[0]}::${args[1]}`;
      this.rateLimits.set(key, {
        window_start_ms: Number(args[2]),
        count: Number(args[3]),
        blocked_until_ms: null
      });
      return { run: { success: true, meta: { changes: 1 } } };
    }
    if (query.includes('UPDATE auth_rate_limits') && query.includes('SET window_start_ms = ?')) {
      const key = `${args[2]}::${args[3]}`;
      this.rateLimits.set(key, {
        window_start_ms: Number(args[0]),
        count: 1,
        blocked_until_ms: null
      });
      return { run: { success: true, meta: { changes: 1 } } };
    }
    if (query.includes('UPDATE auth_rate_limits') && query.includes('SET blocked_until_ms = ?')) {
      const key = `${args[2]}::${args[3]}`;
      const current = this.rateLimits.get(key);
      if (current) current.blocked_until_ms = Number(args[0]);
      return { run: { success: true, meta: { changes: 1 } } };
    }
    if (query.includes('UPDATE auth_rate_limits') && query.includes('SET count = ?')) {
      const key = `${args[2]}::${args[3]}`;
      const current = this.rateLimits.get(key);
      if (current) current.count = Number(args[0]);
      return { run: { success: true, meta: { changes: 1 } } };
    }
    if (query.includes('SELECT credential_id FROM auth_passkeys WHERE user_id = ?')) {
      const userId = String(args[0]);
      return {
        results: Array.from(this.passkeys.values())
          .filter((row) => row.user_id === userId)
          .map((row) => ({ credential_id: row.credential_id }))
      };
    }
    if (query.includes('SELECT credential_id FROM auth_passkeys')) {
      return {
        results: Array.from(this.passkeys.values())
          .map((row) => ({ credential_id: row.credential_id }))
      };
    }
    if (query.includes('INSERT INTO auth_passkeys')) {
      const row: PasskeyRow = {
        id: String(args[0]),
        user_id: String(args[1]),
        credential_id: String(args[2]),
        credential_public_key: String(args[3]),
        algorithm: Number(args[4]),
        counter: Number(args[5]),
        device_type: String(args[6]),
        backup_eligible: Number(args[7]),
        backup_state: Number(args[8]),
        name: args[9] == null ? null : String(args[9]),
        last_used_at: args[10] == null ? null : String(args[10]),
        created_at: String(args[11]),
        updated_at: String(args[11])
      };
      this.passkeys.set(row.credential_id, row);
      return { run: { success: true, meta: { changes: 1 } } };
    }
    if (query.includes('SELECT id, user_id, credential_public_key, algorithm, counter, backup_eligible, backup_state, name, last_used_at FROM auth_passkeys WHERE credential_id = ?')) {
      return { first: this.passkeys.get(String(args[0])) ?? null };
    }
    if (query.includes('UPDATE auth_passkeys SET counter = ?, last_used_at = ? WHERE id = ?')) {
      const id = String(args[2]);
      const row = Array.from(this.passkeys.values()).find((item) => item.id === id) ?? null;
      if (row) {
        row.counter = Number(args[0]);
        row.last_used_at = String(args[1]);
      }
      return { run: { success: true, meta: { changes: row ? 1 : 0 } } };
    }
    if (query.includes('SELECT id, username, role FROM users WHERE id = ?')) {
      return { first: this.users.get(String(args[0])) ?? null };
    }
    if (query.includes('FROM users WHERE id = ?')) {
      const user = this.users.get(String(args[0]));
      if (!user) return { first: null };
      return {
        first: {
          ...user,
          linked_person_id: null,
          linked_person_name: null,
          linked_person_avatar_url: null
        }
      };
    }
    if (query.includes('INSERT INTO sessions')) {
      this.sessions.push({
        id: args[0],
        user_id: args[1],
        created_at: args[2],
        expires_at: args[3]
      });
      return { run: { success: true, meta: { changes: 1 } } };
    }
    throw new Error(`Unhandled query in test mock: ${query}`);
  }
}

const toBase64Url = (bytes: Uint8Array | ArrayBuffer) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(view).toString('base64url');
};

const encodeUtf8 = (value: string) => new TextEncoder().encode(value);

const concatBytes = (...values: Uint8Array[]) => {
  const size = values.reduce((sum, item) => sum + item.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const value of values) {
    out.set(value, offset);
    offset += value.length;
  }
  return out;
};

const encodeCborInteger = (value: number) => {
  if (value >= 0) {
    if (value < 24) return Uint8Array.of(value);
    if (value < 256) return Uint8Array.of(24, value);
    const encoded = new Uint8Array(2);
    new DataView(encoded.buffer).setUint16(0, value);
    return concatBytes(Uint8Array.of(25), encoded);
  }
  const normalized = -1 - value;
  if (normalized < 24) return Uint8Array.of(0x20 | normalized);
  if (normalized < 256) return Uint8Array.of(0x38, normalized);
  const encoded = new Uint8Array(2);
  new DataView(encoded.buffer).setUint16(0, normalized);
  return concatBytes(Uint8Array.of(0x39), encoded);
};

const encodeCborBytes = (value: Uint8Array) => {
  if (value.length < 24) {
    return concatBytes(Uint8Array.of(0x40 | value.length), value);
  }
  if (value.length < 256) {
    return concatBytes(Uint8Array.of(0x58, value.length), value);
  }
  const length = new Uint8Array(2);
  new DataView(length.buffer).setUint16(0, value.length);
  return concatBytes(Uint8Array.of(0x59), length, value);
};

const encodeCoseEc2PublicKey = (x: Uint8Array, y: Uint8Array) => concatBytes(
  Uint8Array.of(0xa5),
  encodeCborInteger(1), encodeCborInteger(2),
  encodeCborInteger(3), encodeCborInteger(-7),
  encodeCborInteger(-1), encodeCborInteger(1),
  encodeCborInteger(-2), encodeCborBytes(x),
  encodeCborInteger(-3), encodeCborBytes(y)
);

const encodeCoseRsaPublicKey = (n: Uint8Array, e: Uint8Array) => concatBytes(
  Uint8Array.of(0xa4),
  encodeCborInteger(1), encodeCborInteger(3),
  encodeCborInteger(3), encodeCborInteger(-257),
  encodeCborInteger(-1), encodeCborBytes(n),
  encodeCborInteger(-2), encodeCborBytes(e)
);

const createAuthenticatorData = async (rpId: string, counter: number, flags = 0x01) => {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encodeUtf8(rpId)));
  const counterBytes = new Uint8Array(4);
  new DataView(counterBytes.buffer).setUint32(0, counter);
  return concatBytes(hash, Uint8Array.of(flags), counterBytes);
};

const createClientDataJson = (type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string) => {
  const json = JSON.stringify({ type, challenge, origin });
  return {
    raw: encodeUtf8(json),
    encoded: toBase64Url(encodeUtf8(json))
  };
};

const getCookieHeader = (response: Response) => {
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'expected set-cookie header');
  return setCookie.split(';', 1)[0] ?? '';
};

const createTestApp = () => {
  const db = new MockD1Database();
  const app = new Hono<AppBindings>();
  app.use('/api/auth/passkey/register/*', async (c, next) => {
    c.set('sessionUser', {
      userId: 'user-1',
      username: 'admin@example.com',
      role: 'admin'
    });
    await next();
  });
  registerAuthRoutes(app);
  const env = {
    DB: db as unknown as D1Database,
    FRONTEND_ORIGIN: 'http://localhost:5173',
    ENVIRONMENT: 'development'
  } as AppBindings['Bindings'];
  return { app, db, env };
};

test('passkey registration rejects mismatched challenge', async () => {
  const { app, db, env } = createTestApp();
  const begin = await app.request('/api/auth/passkey/register/begin', {}, env);
  assert.equal(begin.status, 200);
  const cookieHeader = getCookieHeader(begin);

  const body = await begin.json() as { challenge: string };
  const authenticatorData = await createAuthenticatorData('localhost', 1);
  const wrongClientData = createClientDataJson('webauthn.create', 'wrong-challenge', 'http://localhost:5173');

  const finish = await app.request('/api/auth/passkey/register/finish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookieHeader
    },
    body: JSON.stringify({
      id: 'cred-1',
      name: 'Laptop',
      response: {
        clientDataJSON: wrongClientData.encoded,
        authenticatorData: toBase64Url(authenticatorData),
        publicKey: toBase64Url(new Uint8Array([1, 2, 3])),
        alg: -7
      }
    })
  }, env);

  assert.equal(finish.status, 400);
  assert.match(await finish.text(), /Invalid challenge/);
  assert.equal(db.passkeys.size, 0);
  void body;
});

test('passkey registration and login succeed with a real signed assertion', async () => {
  const { app, db, env } = createTestApp();
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const x = Buffer.from(jwk.x ?? '', 'base64url');
  const y = Buffer.from(jwk.y ?? '', 'base64url');
  const cosePublicKey = encodeCoseEc2PublicKey(new Uint8Array(x), new Uint8Array(y));

  const registerBegin = await app.request('/api/auth/passkey/register/begin', {}, env);
  assert.equal(registerBegin.status, 200);
  const registerCookie = getCookieHeader(registerBegin);
  const registerBody = await registerBegin.json() as {
    challenge: string;
    user: { id: string };
  };
  assert.equal(typeof registerBody.user?.id, 'string');

  const registerAuthData = await createAuthenticatorData('localhost', 1);
  const registerClientData = createClientDataJson('webauthn.create', String(registerBody.challenge), 'http://localhost:5173');
  const registerFinish = await app.request('/api/auth/passkey/register/finish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: registerCookie
    },
    body: JSON.stringify({
      id: 'cred-1',
      name: 'Laptop',
      response: {
        clientDataJSON: registerClientData.encoded,
        authenticatorData: toBase64Url(registerAuthData),
        publicKey: toBase64Url(cosePublicKey),
        alg: -7
      }
    })
  }, env);

  assert.equal(registerFinish.status, 200);
  assert.equal(db.passkeys.size, 1);
  const storedPasskey = db.passkeys.get('cred-1');
  assert.ok(storedPasskey);
  assert.equal(storedPasskey.device_type, 'single_device');
  assert.equal(storedPasskey.backup_eligible, 0);
  assert.equal(storedPasskey.backup_state, 0);

  const loginBegin = await app.request('/api/auth/passkey/login/begin', {}, env);
  assert.equal(loginBegin.status, 200);
  const loginCookie = getCookieHeader(loginBegin);
  const loginBody = await loginBegin.json() as { challenge: string };

  const loginAuthData = await createAuthenticatorData('localhost', 2);
  const loginClientData = createClientDataJson('webauthn.get', String(loginBody.challenge), 'http://localhost:5173');
  const loginClientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', loginClientData.raw));
  const signedPayload = concatBytes(loginAuthData, loginClientHash);
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    signedPayload
  ));

  const loginFinish = await app.request('/api/auth/passkey/login/finish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: loginCookie
    },
    body: JSON.stringify({
      id: 'cred-1',
      userHandle: String(registerBody.user.id),
      response: {
        clientDataJSON: loginClientData.encoded,
        authenticatorData: toBase64Url(loginAuthData),
        signature: toBase64Url(signature)
      }
    })
  }, env);

  assert.equal(loginFinish.status, 200);
  const loginJson = await loginFinish.json() as { user: { id: string } };
  assert.equal(loginJson.user.id, 'user-1');
  assert.equal(db.sessions.length, 1);
  assert.equal(db.passkeys.get('cred-1')?.counter, 2);
});

test('passkey registration stores RSA algorithm and login succeeds with an RSA assertion', async () => {
  const { app, db, env } = createTestApp();
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const n = Buffer.from(jwk.n ?? '', 'base64url');
  const e = Buffer.from(jwk.e ?? '', 'base64url');
  const cosePublicKey = encodeCoseRsaPublicKey(new Uint8Array(n), new Uint8Array(e));

  const registerBegin = await app.request('/api/auth/passkey/register/begin', {}, env);
  assert.equal(registerBegin.status, 200);
  const registerCookie = getCookieHeader(registerBegin);
  const registerBody = await registerBegin.json() as { challenge: string };
  const registerAuthData = await createAuthenticatorData('localhost', 1);
  const registerClientData = createClientDataJson('webauthn.create', String(registerBody.challenge), 'http://localhost:5173');

  const registerFinish = await app.request('/api/auth/passkey/register/finish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: registerCookie
    },
    body: JSON.stringify({
      id: 'cred-rsa-1',
      name: 'Security key',
      response: {
        clientDataJSON: registerClientData.encoded,
        authenticatorData: toBase64Url(registerAuthData),
        publicKey: toBase64Url(cosePublicKey)
      }
    })
  }, env);

  assert.equal(registerFinish.status, 200);
  assert.equal(db.passkeys.get('cred-rsa-1')?.algorithm, -257);

  const loginBegin = await app.request('/api/auth/passkey/login/begin', {}, env);
  assert.equal(loginBegin.status, 200);
  const loginCookie = getCookieHeader(loginBegin);
  const loginBody = await loginBegin.json() as { challenge: string };
  const loginAuthData = await createAuthenticatorData('localhost', 2);
  const loginClientData = createClientDataJson('webauthn.get', String(loginBody.challenge), 'http://localhost:5173');
  const loginClientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', loginClientData.raw));
  const signedPayload = concatBytes(loginAuthData, loginClientHash);
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keyPair.privateKey,
    signedPayload
  ));

  const loginFinish = await app.request('/api/auth/passkey/login/finish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: loginCookie
    },
    body: JSON.stringify({
      id: 'cred-rsa-1',
      response: {
        clientDataJSON: loginClientData.encoded,
        authenticatorData: toBase64Url(loginAuthData),
        signature: toBase64Url(signature)
      }
    })
  }, env);

  assert.equal(loginFinish.status, 200);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.passkeys.get('cred-rsa-1')?.counter, 2);
});
