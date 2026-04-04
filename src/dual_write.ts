import type { Context } from 'hono';
import { timingSafeEqual } from './auth';
import type { AppBindings, Env } from './types';

type RemoteConfig = {
  baseUrl: string;
  origin: string;
  username: string;
  password: string;
  sharedSecret: string;
};

let cachedCookie: string | null = null;
const textEncoder = new TextEncoder();
const DUAL_WRITE_MAX_SKEW_MS = 5 * 60 * 1000;
const DUAL_WRITE_PATH_PREFIXES = ['/api/admin/backup/', '/api/layers', '/api/people', '/api/relationships'];
let dualWriteNonceTableReady = false;
let nextDualWriteNonceCleanupAt = 0;

const parseSetCookie = (setCookieHeaders: (string | null)[] = []) => {
  const cookies = setCookieHeaders
    .map((entry) => (entry ? entry.split(';')[0] : ''))
    .filter(Boolean);
  return cookies.join('; ');
};

const getSetCookieHeaders = (headers: Headers): (string | null)[] => {
  const candidate = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof candidate.getSetCookie === 'function') {
    return candidate.getSetCookie();
  }
  return [headers.get('set-cookie')];
};

const normalizeBaseUrl = (rawBaseUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new Error('Dual-write disabled: invalid DUAL_WRITE_REMOTE_BASE');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Dual-write disabled: DUAL_WRITE_REMOTE_BASE must use http or https');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Dual-write disabled: DUAL_WRITE_REMOTE_BASE must not include credentials, query, or fragment');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/+$/, '');
};

const isAllowedMirrorPath = (path: string) => {
  if (!path.startsWith('/api/')) return false;
  if (path.includes('://') || path.includes('\\') || path.includes('/../') || path.includes('/./')) return false;
  if (path.endsWith('/..') || path.endsWith('/.')) return false;
  return DUAL_WRITE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
};

const hmacSha256Base64 = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
};

const sha256Base64 = async (bytes: ArrayBuffer) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
};

export const hashRequestBody = async (body?: BodyInit | null) => {
  if (body === undefined || body === null) {
    return sha256Base64(textEncoder.encode('').buffer);
  }
  if (typeof body === 'string') {
    return sha256Base64(textEncoder.encode(body).buffer);
  }
  if (body instanceof URLSearchParams) {
    return sha256Base64(textEncoder.encode(body.toString()).buffer);
  }
  const request = new Request('http://localhost/__dual_write_body__', {
    method: 'POST',
    body
  });
  return sha256Base64(await request.arrayBuffer());
};

export const buildDualWriteSignaturePayload = (
  method: string,
  path: string,
  timestamp: string,
  requestId: string,
  bodyHash: string
) => (
  `${method.toUpperCase()}\n${path}\n${timestamp}\n${requestId}\n${bodyHash}`
);

const ensureDualWriteNonceTable = async (db: D1Database) => {
  if (dualWriteNonceTableReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS dual_write_nonces (
      request_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`
  ).run();
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_dual_write_nonces_expires_at ON dual_write_nonces(expires_at)'
  ).run();
  dualWriteNonceTableReady = true;
};

const rememberDualWriteRequestId = async (db: D1Database, requestId: string, now: Date) => {
  await ensureDualWriteNonceTable(db);
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + DUAL_WRITE_MAX_SKEW_MS).toISOString();
  if (now.getTime() >= nextDualWriteNonceCleanupAt) {
    await db.prepare(
      'DELETE FROM dual_write_nonces WHERE expires_at <= ?'
    ).bind(nowIso).run();
    nextDualWriteNonceCleanupAt = now.getTime() + DUAL_WRITE_MAX_SKEW_MS;
  }
  const existing = await db.prepare(
    'SELECT request_id FROM dual_write_nonces WHERE request_id = ?'
  ).bind(requestId).first();
  if (existing) {
    return false;
  }
  await db.prepare(
    'INSERT INTO dual_write_nonces (request_id, created_at, expires_at) VALUES (?, ?, ?)'
  ).bind(requestId, nowIso, expiresAt).run();
  return true;
};

const getRemoteConfig = (env: Env): RemoteConfig | null => {
  const enabled = String(env.DUAL_WRITE_REMOTE || '').toLowerCase();
  if (enabled !== '1' && enabled !== 'true' && enabled !== 'yes') return null;
  const rawBaseUrl = env.DUAL_WRITE_REMOTE_BASE || '';
  const origin = env.DUAL_WRITE_REMOTE_ORIGIN || '';
  const username = env.DUAL_WRITE_REMOTE_USER || '';
  const password = env.DUAL_WRITE_REMOTE_PASS || '';
  const sharedSecret = env.DUAL_WRITE_SHARED_SECRET || '';
  if (!rawBaseUrl || !origin || !username || !password || !sharedSecret) {
    console.warn('Dual-write disabled: missing DUAL_WRITE_REMOTE_BASE/ORIGIN/USER/PASS/SHARED_SECRET');
    return null;
  }
  try {
    return {
      baseUrl: normalizeBaseUrl(rawBaseUrl),
      origin,
      username,
      password,
      sharedSecret
    };
  } catch (error) {
    console.warn(error instanceof Error ? error.message : 'Dual-write disabled');
    return null;
  }
};

const login = async (config: RemoteConfig) => {
  const res = await fetch(`${config.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: config.origin },
    body: JSON.stringify({ username: config.username, password: config.password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dual-write login failed ${res.status} ${res.statusText}: ${text}`);
  }
  const setCookie = getSetCookieHeaders(res.headers);
  cachedCookie = parseSetCookie(setCookie);
  return cachedCookie;
};

const fetchWithAuth = async (
  config: RemoteConfig,
  path: string,
  init: RequestInit
) => {
  if (!cachedCookie) {
    await login(config);
  }
  const headers = new Headers(init.headers || {});
  const timestamp = new Date().toISOString();
  const requestId = crypto.randomUUID();
  const bodyHash = await hashRequestBody(init.body);
  headers.set('Origin', config.origin);
  headers.set('X-Dual-Write', '1');
  headers.set('X-Dual-Write-Request-Id', requestId);
  headers.set('X-Dual-Write-Body-SHA256', bodyHash);
  headers.set('X-Dual-Write-Timestamp', timestamp);
  headers.set(
    'X-Dual-Write-Signature',
    await hmacSha256Base64(
      config.sharedSecret,
      buildDualWriteSignaturePayload(init.method || 'GET', path, timestamp, requestId, bodyHash)
    )
  );
  if (cachedCookie) {
    headers.set('Cookie', cachedCookie);
  }
  const res = await fetch(`${config.baseUrl}${path}`, { ...init, headers });
  if (res.status === 401) {
    cachedCookie = null;
    await login(config);
    if (cachedCookie) {
      headers.set('Cookie', cachedCookie);
    }
    return fetch(`${config.baseUrl}${path}`, { ...init, headers });
  }
  return res;
};

const executeRemote = async (
  env: Env,
  path: string,
  init: RequestInit
) => {
  const config = getRemoteConfig(env);
  if (!config) return;
  if (!isAllowedMirrorPath(path)) {
    console.warn(`Dual-write skipped disallowed path: ${path}`);
    return;
  }
  try {
    const res = await fetchWithAuth(config, path, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`Dual-write failed ${init.method || 'GET'} ${path}: ${res.status} ${res.statusText} ${text}`);
    }
  } catch (error) {
    console.warn('Dual-write request failed:', error);
  }
};

const shouldMirror = (c: Context<AppBindings>) => {
  if (c.req.header('X-Dual-Write')) return false;
  return Boolean(getRemoteConfig(c.env));
};

const waitUntilIfAvailable = (c: Context<AppBindings>, promise: Promise<unknown>) => {
  try {
    c.executionCtx?.waitUntil(promise);
  } catch {
    void promise;
  }
};

export const queueRemoteJson = (
  c: Context<AppBindings>,
  method: string,
  path: string,
  body: unknown
) => {
  if (!shouldMirror(c)) return;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  waitUntilIfAvailable(c, executeRemote(c.env, path, init));
};

export const queueRemoteFormData = (
  c: Context<AppBindings>,
  path: string,
  formData: FormData
) => {
  if (!shouldMirror(c)) return;
  const init: RequestInit = {
    method: 'POST',
    body: formData
  };
  waitUntilIfAvailable(c, executeRemote(c.env, path, init));
};

export const verifyDualWriteRequest = async (env: Env, request: Request) => {
  const marker = request.headers.get('X-Dual-Write');
  if (!marker) return { ok: true as const };

  const config = getRemoteConfig(env);
  if (!config) {
    return { ok: false as const, status: 503 as const, error: 'Dual-write is not configured' };
  }

  const path = new URL(request.url).pathname;
  if (!isAllowedMirrorPath(path)) {
    return { ok: false as const, status: 403 as const, error: 'Dual-write path is not allowed' };
  }

  const timestamp = request.headers.get('X-Dual-Write-Timestamp') || '';
  const requestId = request.headers.get('X-Dual-Write-Request-Id') || '';
  const bodyHash = request.headers.get('X-Dual-Write-Body-SHA256') || '';
  const signature = request.headers.get('X-Dual-Write-Signature') || '';
  if (!timestamp || !signature || !requestId || !bodyHash) {
    return { ok: false as const, status: 401 as const, error: 'Dual-write signature is required' };
  }

  const requestTime = Date.parse(timestamp);
  const now = new Date();
  if (!Number.isFinite(requestTime) || Math.abs(now.getTime() - requestTime) > DUAL_WRITE_MAX_SKEW_MS) {
    return { ok: false as const, status: 401 as const, error: 'Dual-write signature expired' };
  }

  const expected = await hmacSha256Base64(
    config.sharedSecret,
    buildDualWriteSignaturePayload(
      request.method,
      path,
      timestamp,
      requestId,
      await hashRequestBody(await request.clone().arrayBuffer())
    )
  );
  if (!timingSafeEqual(signature, expected)) {
    return { ok: false as const, status: 401 as const, error: 'Dual-write signature mismatch' };
  }

  const accepted = await rememberDualWriteRequestId(env.DB, requestId, now);
  if (!accepted) {
    return { ok: false as const, status: 409 as const, error: 'Dual-write request replay detected' };
  }

  return { ok: true as const };
};

export const createDualWriteSignature = async (
  sharedSecret: string,
  method: string,
  path: string,
  body?: BodyInit | null,
  timestamp = new Date().toISOString(),
  requestId = crypto.randomUUID()
) => {
  const bodyHash = await hashRequestBody(body);
  const signature = await hmacSha256Base64(
    sharedSecret,
    buildDualWriteSignaturePayload(method, path, timestamp, requestId, bodyHash)
  );
  return { timestamp, requestId, bodyHash, signature };
};
