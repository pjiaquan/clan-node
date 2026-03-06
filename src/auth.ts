import type { Context, Hono, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppBindings, Env, UserRole } from './types';
import { notifyUpdate } from './notify';
import { recordAuditLog } from './audit';

const SESSION_COOKIE = 'clan_session';
const textEncoder = new TextEncoder();
const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60;
const LOGIN_RATE_LIMIT = { windowMs: 10 * 60 * 1000, maxAttempts: 5, blockMs: 15 * 60 * 1000 };
const RESEND_RATE_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 3, blockMs: 30 * 60 * 1000 };

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const randomBase64 = (size = 16) => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toBase64(bytes.buffer);
};

async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: textEncoder.encode(salt) },
    key,
    256
  );
  return toBase64(bits);
}

async function sha256Base64(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
  return toBase64(digest);
}

const normalizeRole = (value: unknown): UserRole => (value === 'admin' ? 'admin' : 'readonly');

const normalizeIdentifier = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeEmail = (value: unknown): string => {
  return normalizeIdentifier(value).toLowerCase();
};

const isValidEmail = (value: string): boolean => (
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
);

type SessionSchemaSupport = {
  hasUserAgent: boolean;
  hasIpAddress: boolean;
  hasLastSeenAt: boolean;
};

type UserSchemaSupport = {
  hasEmail: boolean;
  hasEmailVerifiedAt: boolean;
  hasEmailVerifyTokenHash: boolean;
  hasEmailVerifyExpiresAt: boolean;
};

let sessionSchemaSupportCache: SessionSchemaSupport | null = null;
let userSchemaSupportCache: UserSchemaSupport | null = null;
let authRateLimitTableReady = false;

const addSessionColumnIfMissing = async (
  db: D1Database,
  existing: Set<string>,
  column: string,
  ddl: string
) => {
  if (existing.has(column)) return;
  try {
    await db.prepare(`ALTER TABLE sessions ADD COLUMN ${ddl}`).run();
    existing.add(column);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('duplicate column name')) {
      existing.add(column);
      return;
    }
    throw error;
  }
};

const getSessionSchemaSupport = async (db: D1Database): Promise<SessionSchemaSupport> => {
  if (sessionSchemaSupportCache) return sessionSchemaSupportCache;
  const { results } = await db.prepare("PRAGMA table_info('sessions')").all();
  const names = new Set(
    results
      .map((row) => (row as any).name as string)
      .filter(Boolean)
  );
  // Self-heal old databases created before session metadata fields existed.
  await addSessionColumnIfMissing(db, names, 'user_agent', 'user_agent TEXT');
  await addSessionColumnIfMissing(db, names, 'ip_address', 'ip_address TEXT');
  await addSessionColumnIfMissing(db, names, 'last_seen_at', 'last_seen_at TEXT');
  sessionSchemaSupportCache = {
    hasUserAgent: names.has('user_agent'),
    hasIpAddress: names.has('ip_address'),
    hasLastSeenAt: names.has('last_seen_at')
  };
  return sessionSchemaSupportCache;
};

const addUserColumnIfMissing = async (
  db: D1Database,
  existing: Set<string>,
  column: string,
  ddl: string
) => {
  if (existing.has(column)) return;
  try {
    await db.prepare(`ALTER TABLE users ADD COLUMN ${ddl}`).run();
    existing.add(column);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('duplicate column name')) {
      existing.add(column);
      return;
    }
    throw error;
  }
};

const getUserSchemaSupport = async (db: D1Database): Promise<UserSchemaSupport> => {
  if (userSchemaSupportCache) return userSchemaSupportCache;
  const { results } = await db.prepare("PRAGMA table_info('users')").all();
  const names = new Set(
    results
      .map((row) => (row as any).name as string)
      .filter(Boolean)
  );
  await addUserColumnIfMissing(db, names, 'email', 'email TEXT');
  await addUserColumnIfMissing(db, names, 'email_verified_at', 'email_verified_at TEXT');
  await addUserColumnIfMissing(db, names, 'email_verify_token_hash', 'email_verify_token_hash TEXT');
  await addUserColumnIfMissing(db, names, 'email_verify_expires_at', 'email_verify_expires_at TEXT');
  if (names.has('email')) {
    await db.prepare("UPDATE users SET email = LOWER(TRIM(username)) WHERE email IS NULL OR TRIM(email) = ''").run();
    await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email)').run();
  }
  userSchemaSupportCache = {
    hasEmail: names.has('email'),
    hasEmailVerifiedAt: names.has('email_verified_at'),
    hasEmailVerifyTokenHash: names.has('email_verify_token_hash'),
    hasEmailVerifyExpiresAt: names.has('email_verify_expires_at')
  };
  return userSchemaSupportCache;
};

const buildVerificationUrl = (env: Env, token: string) => {
  const base = (env.EMAIL_VERIFICATION_URL_BASE || env.FRONTEND_ORIGIN || 'http://localhost:5173')
    .split(',')[0]
    ?.trim()
    .replace(/\/+$/, '');
  return `${base}?verify_email_token=${encodeURIComponent(token)}`;
};

const sendVerificationEmail = async (env: Env, to: string, verifyUrl: string) => {
  const apiKey = env.BREVO_API_KEY || '';
  const fromEmail = env.BREVO_FROM_EMAIL || '';
  const fromName = env.BREVO_FROM_NAME || 'Clan Node';
  if (!apiKey || !fromEmail) {
    console.warn('Email verification delivery skipped: missing BREVO_API_KEY or BREVO_FROM_EMAIL');
    return false;
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to }],
      subject: 'Verify your email',
      textContent: `Please verify your email by visiting: ${verifyUrl}`,
      htmlContent: `<p>Please verify your email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`
    })
  });
  if (!response.ok) {
    const text = await response.text();
    console.warn('Failed to send verification email:', response.status, text);
    return false;
  }
  return true;
};

const createVerificationToken = async () => {
  const token = randomBase64(32).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const tokenHash = await sha256Base64(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
  return { token, tokenHash, expiresAt };
};

const hasUsableEmailAccount = async (db: D1Database) => {
  const userSchema = await getUserSchemaSupport(db);
  if (!userSchema.hasEmailVerifiedAt) {
    return false;
  }
  const emailField = userSchema.hasEmail ? 'email' : 'username';
  const existing = await db.prepare(
    `SELECT id
     FROM users
     WHERE ${emailField} IS NOT NULL
       AND TRIM(${emailField}) != ''
       AND INSTR(${emailField}, '@') > 1
       AND INSTR(SUBSTR(${emailField}, INSTR(${emailField}, '@') + 1), '.') > 0
       AND email_verified_at IS NOT NULL
       AND TRIM(email_verified_at) != ''
     LIMIT 1`
  ).first();
  return Boolean(existing);
};

const ensureAuthRateLimitTable = async (db: D1Database) => {
  if (authRateLimitTableReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS auth_rate_limits (
      action TEXT NOT NULL,
      limiter_key TEXT NOT NULL,
      window_start_ms INTEGER NOT NULL,
      count INTEGER NOT NULL,
      blocked_until_ms INTEGER,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (action, limiter_key)
    )`
  ).run();
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_blocked_until ON auth_rate_limits(blocked_until_ms)'
  ).run();
  authRateLimitTableReady = true;
};

type RateLimitInput = {
  action: 'login' | 'resend_verification';
  limiterKey: string;
  windowMs: number;
  maxAttempts: number;
  blockMs: number;
};

const checkAndConsumeRateLimit = async (db: D1Database, input: RateLimitInput) => {
  await ensureAuthRateLimitTable(db);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const existing = await db.prepare(
    `SELECT window_start_ms, count, blocked_until_ms
     FROM auth_rate_limits
     WHERE action = ? AND limiter_key = ?`
  ).bind(input.action, input.limiterKey).first();

  if (!existing) {
    await db.prepare(
      `INSERT INTO auth_rate_limits (action, limiter_key, window_start_ms, count, blocked_until_ms, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).bind(input.action, input.limiterKey, nowMs, 1, nowIso).run();
    return { allowed: true as const };
  }

  const blockedUntilMs = Number((existing as any).blocked_until_ms ?? 0);
  if (blockedUntilMs > nowMs) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((blockedUntilMs - nowMs) / 1000))
    };
  }

  const windowStartMs = Number((existing as any).window_start_ms ?? 0);
  const count = Number((existing as any).count ?? 0);
  const inWindow = nowMs - windowStartMs <= input.windowMs;

  if (!inWindow) {
    await db.prepare(
      `UPDATE auth_rate_limits
       SET window_start_ms = ?, count = 1, blocked_until_ms = NULL, updated_at = ?
       WHERE action = ? AND limiter_key = ?`
    ).bind(nowMs, nowIso, input.action, input.limiterKey).run();
    return { allowed: true as const };
  }

  if (count >= input.maxAttempts) {
    const nextBlockedUntil = nowMs + input.blockMs;
    await db.prepare(
      `UPDATE auth_rate_limits
       SET blocked_until_ms = ?, updated_at = ?
       WHERE action = ? AND limiter_key = ?`
    ).bind(nextBlockedUntil, nowIso, input.action, input.limiterKey).run();
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil(input.blockMs / 1000))
    };
  }

  await db.prepare(
    `UPDATE auth_rate_limits
     SET count = ?, updated_at = ?
     WHERE action = ? AND limiter_key = ?`
  ).bind(count + 1, nowIso, input.action, input.limiterKey).run();

  return { allowed: true as const };
};

const getRequestUserAgent = (c: Context<AppBindings>) => (
  c.req.header('User-Agent')
  || c.req.header('user-agent')
  || null
);

const getRequestIpAddress = (c: Context<AppBindings>) => {
  const cfIp = c.req.header('CF-Connecting-IP') || c.req.header('cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwarded = c.req.header('x-forwarded-for');
  if (!forwarded) return null;
  return forwarded.split(',')[0]?.trim() || null;
};

const classifyClient = (userAgent?: string | null) => {
  const ua = (userAgent || '').toLowerCase();
  let browser = 'Unknown';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('samsungbrowser/')) browser = 'Samsung Internet';
  else if (ua.includes('crios/')) browser = 'Chrome (iOS)';
  else if (ua.includes('chrome/')) browser = 'Chrome';
  else if (ua.includes('firefox/')) browser = 'Firefox';
  else if (ua.includes('safari/') && !ua.includes('chrome/') && !ua.includes('crios/')) browser = 'Safari';
  else if (ua.includes('wv')) browser = 'WebView';

  let platform = 'Unknown';
  if (ua.includes('android')) platform = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) platform = 'iOS';
  else if (ua.includes('windows')) platform = 'Windows';
  else if (ua.includes('mac os')) platform = 'macOS';
  else if (ua.includes('linux')) platform = 'Linux';

  const deviceLabel = platform === 'Unknown' ? browser : `${platform} · ${browser}`;
  return { browser, platform, deviceLabel };
};

async function getSessionUser(db: D1Database, sessionId: string) {
  const now = new Date().toISOString();
  const row = await db.prepare(
    `SELECT s.id as session_id, s.user_id as user_id, s.expires_at as expires_at,
            u.username as username, u.role as role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  ).bind(sessionId, now).first();
  if (!row) return null;
  return {
    sessionId: (row as any).session_id as string,
    userId: (row as any).user_id as string,
    username: (row as any).username as string,
    role: normalizeRole((row as any).role)
  };
}

const isSecureRequest = (env: Env) => env.ENVIRONMENT === 'production';

const clearSessionCookie = (c: Context<AppBindings>) => {
  const isSecure = isSecureRequest(c.env);
  deleteCookie(c, SESSION_COOKIE, { path: '/', sameSite: isSecure ? 'None' : 'Lax', secure: isSecure });
};

const getSessionIdFromRequest = (c: Context<AppBindings>) => {
  const cookieSession = getCookie(c, SESSION_COOKIE);
  return cookieSession || null;
};

export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const path = c.req.path;
  if (
    path.startsWith('/api/auth/login')
    || path.startsWith('/api/auth/setup')
    || path.startsWith('/api/auth/verify-email')
    || path.startsWith('/api/auth/resend-verification')
  ) {
    return next();
  }
  if (path.startsWith('/api/auth/me')) {
    return next();
  }

  const sessionId = getSessionIdFromRequest(c);
  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionUser = await getSessionUser(c.env.DB, sessionId);
  if (!sessionUser) {
    clearSessionCookie(c);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('sessionUser', {
    userId: sessionUser.userId,
    username: sessionUser.username,
    role: sessionUser.role
  });

  try {
    const schema = await getSessionSchemaSupport(c.env.DB);
    const updates: string[] = [];
    const values: Array<string | null> = [];
    if (schema.hasLastSeenAt) {
      updates.push('last_seen_at = ?');
      values.push(new Date().toISOString());
    }
    if (schema.hasUserAgent) {
      updates.push('user_agent = COALESCE(user_agent, ?)');
      values.push(getRequestUserAgent(c));
    }
    if (schema.hasIpAddress) {
      updates.push('ip_address = COALESCE(ip_address, ?)');
      values.push(getRequestIpAddress(c));
    }
    if (updates.length > 0) {
      await c.env.DB.prepare(
        `UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...values, sessionUser.sessionId).run();
    }
  } catch (error) {
    console.warn('Failed to update session metadata:', error);
  }

  return next();
};

export const requireWriteAccess: MiddlewareHandler<AppBindings> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const path = c.req.path;
  if (
    path.startsWith('/api/auth/login')
    || path.startsWith('/api/auth/setup')
    || path.startsWith('/api/auth/verify-email')
    || path.startsWith('/api/auth/resend-verification')
    || path.startsWith('/api/auth/logout')
    || path.startsWith('/api/auth/sessions')
    || (path.startsWith('/api/notifications') && method === 'POST')
  ) {
    return next();
  }

  const sessionUser = c.get('sessionUser');
  if (!sessionUser || sessionUser.role !== 'admin') {
    return c.json({ error: 'Read-only account' }, 403);
  }

  return next();
};

export const requireCsrf: MiddlewareHandler<AppBindings> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const normalize = (value: string) => value.replace(/\/+$/, '').toLowerCase();
  const allowedOrigins = (c.env.FRONTEND_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(entry => normalize(entry.trim()))
    .filter(Boolean);
  const originHeader = c.req.header('Origin') || c.req.header('origin');
  const refererHeader = c.req.header('Referer') || c.req.header('referer');
  const origin = originHeader
    || (refererHeader ? (() => {
      try {
        return new URL(refererHeader).origin;
      } catch {
        return '';
      }
    })() : '');

  if (!origin) {
    console.warn('CSRF blocked: missing Origin/Referer', {
      method,
      path: c.req.path,
      referer: refererHeader || null
    });
    return c.json({ error: 'Forbidden' }, 403);
  }

  const normalizedOrigin = normalize(origin);
  if (!allowedOrigins.includes(normalizedOrigin)) {
    console.warn('CSRF blocked: disallowed origin', {
      method,
      path: c.req.path,
      origin,
      referer: refererHeader || null,
      allowedOrigins
    });
    return c.json({ error: 'Forbidden' }, 403);
  }

  return next();
};

export function registerAuthRoutes(app: Hono<AppBindings>) {
  app.get('/api/auth/setup', async (c) => {
    const ready = await hasUsableEmailAccount(c.env.DB);
    return c.json({ requires_setup: !ready });
  });

  app.post('/api/auth/setup', async (c) => {
    const configuredToken = c.env.ADMIN_SETUP_TOKEN?.trim() || '';
    const requestToken = (c.req.header('x-setup-token') || '').trim();
    if (configuredToken && requestToken !== configuredToken) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const userSchema = await getUserSchemaSupport(c.env.DB);
    const ready = await hasUsableEmailAccount(c.env.DB);
    if (ready) {
      return c.json({ error: 'Admin already exists' }, 409);
    }

    const body = await c.req.json();
    const password = typeof (body as any)?.password === 'string' ? (body as any).password : '';
    const email = normalizeEmail((body as any)?.email ?? (body as any)?.username);
    if (!email || !password) {
      return c.json({ error: 'email and password are required' }, 400);
    }
    if (!isValidEmail(email)) {
      return c.json({ error: 'Invalid email format' }, 400);
    }

    const id = crypto.randomUUID();
    const salt = randomBase64(16);
    const passwordHash = await hashPassword(password, salt);
    const now = new Date().toISOString();

    const columns = ['id', 'username', 'password_hash', 'password_salt', 'role', 'created_at', 'updated_at'];
    const values: Array<string | null> = [id, email, passwordHash, salt, 'admin', now, now];
    if (userSchema.hasEmail) {
      columns.push('email');
      values.push(email);
    }
    if (userSchema.hasEmailVerifiedAt) {
      columns.push('email_verified_at');
      values.push(now);
    }
    await c.env.DB.prepare(
      `INSERT INTO users (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...values).run();

    notifyUpdate(c, 'user:setup', {
      id,
      username: email,
      role: 'admin'
    });
    await recordAuditLog(c, {
      action: 'setup',
      resourceType: 'users',
      resourceId: id,
      summary: `初始化管理員帳號 ${email}`,
      details: {
        username: email,
        role: 'admin'
      }
    });
    return c.json({ id, username: email, email }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const userSchema = await getUserSchemaSupport(c.env.DB);
    const body = await c.req.json();
    const password = typeof (body as any)?.password === 'string' ? (body as any).password : '';
    const email = normalizeEmail((body as any)?.email ?? (body as any)?.username);
    if (!email || !password) {
      return c.json({ error: 'email and password are required' }, 400);
    }
    if (!isValidEmail(email)) {
      return c.json({ error: 'Invalid email format' }, 400);
    }

    const loginIp = getRequestIpAddress(c) || 'unknown-ip';
    const loginRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'login',
      limiterKey: `${loginIp}:${email}`,
      windowMs: LOGIN_RATE_LIMIT.windowMs,
      maxAttempts: LOGIN_RATE_LIMIT.maxAttempts,
      blockMs: LOGIN_RATE_LIMIT.blockMs
    });
    if (!loginRateLimit.allowed) {
      c.header('Retry-After', String(loginRateLimit.retryAfterSeconds));
      return c.json({ error: 'Too many login attempts. Please try again later.' }, 429);
    }

    const loginField = userSchema.hasEmail ? 'email' : 'username';
    const verifyField = userSchema.hasEmailVerifiedAt ? ', email_verified_at' : '';
    const user = await c.env.DB.prepare(
      `SELECT id, username, password_hash, password_salt, role${verifyField} FROM users WHERE ${loginField} = ?`
    ).bind(email).first();
    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    if (userSchema.hasEmailVerifiedAt && !(user as any).email_verified_at) {
      return c.json({ error: 'Email not verified', email }, 403);
    }

    const salt = (user as any).password_salt as string;
    const expectedHash = (user as any).password_hash as string;
    const actualHash = await hashPassword(password, salt);
    if (actualHash !== expectedHash) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const sessionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);
    const schema = await getSessionSchemaSupport(c.env.DB);
    const columns = ['id', 'user_id', 'created_at', 'expires_at'];
    const values: Array<string | null> = [
      sessionId,
      (user as any).id as string,
      now.toISOString(),
      expiresAt.toISOString()
    ];
    if (schema.hasUserAgent) {
      columns.push('user_agent');
      values.push(getRequestUserAgent(c));
    }
    if (schema.hasIpAddress) {
      columns.push('ip_address');
      values.push(getRequestIpAddress(c));
    }
    if (schema.hasLastSeenAt) {
      columns.push('last_seen_at');
      values.push(now.toISOString());
    }
    await c.env.DB.prepare(
      `INSERT INTO sessions (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...values).run();

    const isSecure = isSecureRequest(c.env);
    const sameSite = isSecure ? 'None' : 'Lax';
    setCookie(c, SESSION_COOKIE, sessionId, {
      httpOnly: true,
      path: '/',
      sameSite,
      secure: isSecure,
      expires: expiresAt
    });

    return c.json({
      user: {
        id: (user as any).id,
        username: (user as any).username,
        email: (user as any).username,
        role: normalizeRole((user as any).role)
      }
    });
  });

  app.post('/api/auth/verify-email', async (c) => {
    const userSchema = await getUserSchemaSupport(c.env.DB);
    if (!userSchema.hasEmail || !userSchema.hasEmailVerifiedAt || !userSchema.hasEmailVerifyTokenHash || !userSchema.hasEmailVerifyExpiresAt) {
      return c.json({ error: 'Email verification is not available' }, 503);
    }

    const body = await c.req.json();
    const token = normalizeIdentifier((body as any)?.token);
    if (!token) {
      return c.json({ error: 'token is required' }, 400);
    }

    const tokenHash = await sha256Base64(token);
    const now = new Date().toISOString();
    const user = await c.env.DB.prepare(
      `SELECT id, email
       FROM users
       WHERE email_verify_token_hash = ?
         AND email_verify_expires_at IS NOT NULL
         AND email_verify_expires_at > ?`
    ).bind(tokenHash, now).first();
    if (!user) {
      return c.json({ error: 'Invalid or expired token' }, 400);
    }

    await c.env.DB.prepare(
      `UPDATE users
       SET email_verified_at = ?, email_verify_token_hash = NULL, email_verify_expires_at = NULL, updated_at = ?
       WHERE id = ?`
    ).bind(now, now, (user as any).id as string).run();

    await recordAuditLog(c, {
      action: 'verify_email',
      resourceType: 'users',
      resourceId: (user as any).id as string,
      summary: `驗證 Email ${(user as any).email as string}`,
      details: {
        email: (user as any).email as string
      }
    });

    return c.json({ ok: true, email: (user as any).email as string });
  });

  app.post('/api/auth/resend-verification', async (c) => {
    const userSchema = await getUserSchemaSupport(c.env.DB);
    if (!userSchema.hasEmail || !userSchema.hasEmailVerifiedAt || !userSchema.hasEmailVerifyTokenHash || !userSchema.hasEmailVerifyExpiresAt) {
      return c.json({ ok: true });
    }

    const body = await c.req.json();
    const email = normalizeEmail((body as any)?.email);
    if (!email || !isValidEmail(email)) {
      return c.json({ ok: true });
    }

    const resendIp = getRequestIpAddress(c) || 'unknown-ip';
    const resendRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'resend_verification',
      limiterKey: `${resendIp}:${email}`,
      windowMs: RESEND_RATE_LIMIT.windowMs,
      maxAttempts: RESEND_RATE_LIMIT.maxAttempts,
      blockMs: RESEND_RATE_LIMIT.blockMs
    });
    if (!resendRateLimit.allowed) {
      c.header('Retry-After', String(resendRateLimit.retryAfterSeconds));
      return c.json({ error: 'Too many resend requests. Please try again later.' }, 429);
    }

    const user = await c.env.DB.prepare(
      'SELECT id, email, email_verified_at FROM users WHERE email = ?'
    ).bind(email).first();
    if (!user || (user as any).email_verified_at) {
      return c.json({ ok: true });
    }

    const { token, tokenHash, expiresAt } = await createVerificationToken();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE users
       SET email_verify_token_hash = ?, email_verify_expires_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(tokenHash, expiresAt, now, (user as any).id as string).run();

    const verifyUrl = buildVerificationUrl(c.env, token);
    const delivered = await sendVerificationEmail(c.env, email, verifyUrl);

    await recordAuditLog(c, {
      action: 'resend_verification',
      resourceType: 'users',
      resourceId: (user as any).id as string,
      summary: `重送 Email 驗證信 ${email}`,
      details: {
        email,
        delivered
      }
    });

    const debugToken = c.env.ENVIRONMENT === 'production' ? null : token;
    return c.json({ ok: true, delivered, ...(debugToken ? { debug_verify_token: debugToken } : {}) });
  });

  app.post('/api/auth/logout', async (c) => {
    const sessionId = getSessionIdFromRequest(c);
    if (sessionId) {
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    }
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', async (c) => {
    const sessionId = getSessionIdFromRequest(c);
    if (!sessionId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sessionUser = await getSessionUser(c.env.DB, sessionId);
    if (!sessionUser) {
      clearSessionCookie(c);
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return c.json({
      user: {
        id: sessionUser.userId,
        username: sessionUser.username,
        email: sessionUser.username,
        role: sessionUser.role
      }
    });
  });

  app.get('/api/auth/sessions', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const schema = await getSessionSchemaSupport(c.env.DB);
    const fields = ['id', 'user_id', 'created_at', 'expires_at'];
    if (schema.hasUserAgent) fields.push('user_agent');
    if (schema.hasIpAddress) fields.push('ip_address');
    if (schema.hasLastSeenAt) fields.push('last_seen_at');

    const nowIso = new Date().toISOString();
    const { results } = await c.env.DB.prepare(
      `SELECT ${fields.join(', ')} FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC`
    ).bind(sessionUser.userId, nowIso).all();

    const currentSessionId = getSessionIdFromRequest(c);
    return c.json(results.map((row) => {
      const userAgent = schema.hasUserAgent ? ((row as any).user_agent as string | null) : null;
      const client = classifyClient(userAgent);
      return {
        id: (row as any).id as string,
        user_id: (row as any).user_id as string,
        created_at: (row as any).created_at as string,
        expires_at: (row as any).expires_at as string,
        user_agent: userAgent,
        ip_address: schema.hasIpAddress ? ((row as any).ip_address as string | null) : null,
        last_seen_at: schema.hasLastSeenAt ? ((row as any).last_seen_at as string | null) : null,
        browser: client.browser,
        platform: client.platform,
        device_label: client.deviceLabel,
        current: currentSessionId ? (currentSessionId === (row as any).id) : false
      };
    }));
  });

  app.delete('/api/auth/sessions/:id', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      'SELECT id, user_id FROM sessions WHERE id = ?'
    ).bind(id).first();
    if (!existing) {
      return c.json({ error: 'Session not found' }, 404);
    }
    if ((existing as any).user_id !== sessionUser.userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    const currentSessionId = getSessionIdFromRequest(c);
    if (currentSessionId && currentSessionId === id) {
      clearSessionCookie(c);
    }
    await recordAuditLog(c, {
      action: 'revoke',
      resourceType: 'sessions',
      resourceId: id,
      summary: `撤銷 session ${id}`,
      details: {
        session_id: id,
        current: Boolean(currentSessionId && currentSessionId === id)
      }
    });
    return c.json({ ok: true, current: Boolean(currentSessionId && currentSessionId === id) });
  });

  app.post('/api/auth/sessions/revoke-others', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const currentSessionId = getSessionIdFromRequest(c);
    if (!currentSessionId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const result = await c.env.DB.prepare(
      'DELETE FROM sessions WHERE user_id = ? AND id != ?'
    ).bind(sessionUser.userId, currentSessionId).run();
    await recordAuditLog(c, {
      action: 'revoke_others',
      resourceType: 'sessions',
      summary: '撤銷其他登入 session',
      details: {
        deleted: Number(result.meta?.changes ?? 0)
      }
    });
    return c.json({ ok: true, deleted: Number(result.meta?.changes ?? 0) });
  });

  app.post('/api/auth/users', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const userSchema = await getUserSchemaSupport(c.env.DB);

    const body = await c.req.json();
    const password = typeof (body as any)?.password === 'string' ? (body as any).password : '';
    const email = normalizeEmail((body as any)?.email ?? (body as any)?.username);
    const role = (body as any)?.role as UserRole | undefined;
    if (!email || !password) {
      return c.json({ error: 'email and password are required' }, 400);
    }
    if (!isValidEmail(email)) {
      return c.json({ error: 'Invalid email format' }, 400);
    }

    const finalRole: UserRole = role === 'admin' ? 'admin' : 'readonly';
    const existingField = userSchema.hasEmail ? 'email' : 'username';
    const existing = await c.env.DB.prepare(
      `SELECT id FROM users WHERE ${existingField} = ?`
    ).bind(email).first();
    if (existing) {
      return c.json({ error: 'User already exists' }, 409);
    }

    const id = crypto.randomUUID();
    const salt = randomBase64(16);
    const passwordHash = await hashPassword(password, salt);
    const now = new Date().toISOString();

    let verifyToken: string | null = null;
    let verifyTokenHash: string | null = null;
    let verifyExpiresAt: string | null = null;
    if (userSchema.hasEmailVerifyTokenHash && userSchema.hasEmailVerifyExpiresAt) {
      const token = await createVerificationToken();
      verifyToken = token.token;
      verifyTokenHash = token.tokenHash;
      verifyExpiresAt = token.expiresAt;
    }

    const columns = ['id', 'username', 'password_hash', 'password_salt', 'role', 'created_at', 'updated_at'];
    const values: Array<string | null> = [id, email, passwordHash, salt, finalRole, now, now];
    if (userSchema.hasEmail) {
      columns.push('email');
      values.push(email);
    }
    if (userSchema.hasEmailVerifiedAt) {
      columns.push('email_verified_at');
      values.push(null);
    }
    if (userSchema.hasEmailVerifyTokenHash) {
      columns.push('email_verify_token_hash');
      values.push(verifyTokenHash);
    }
    if (userSchema.hasEmailVerifyExpiresAt) {
      columns.push('email_verify_expires_at');
      values.push(verifyExpiresAt);
    }
    await c.env.DB.prepare(
      `INSERT INTO users (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...values).run();

    let delivered = false;
    if (verifyToken) {
      const verifyUrl = buildVerificationUrl(c.env, verifyToken);
      delivered = await sendVerificationEmail(c.env, email, verifyUrl);
    }

    notifyUpdate(c, 'user:create', {
      id,
      username: email,
      role: finalRole
    });
    await recordAuditLog(c, {
      action: 'create',
      resourceType: 'users',
      resourceId: id,
      summary: `新增帳號 ${email}`,
      details: {
        username: email,
        role: finalRole,
        verification_email_sent: delivered
      }
    });
    const debugToken = (c.env.ENVIRONMENT === 'production' || !verifyToken) ? null : verifyToken;
    return c.json({
      id,
      username: email,
      email,
      role: finalRole,
      email_verified_at: null,
      verification_email_sent: delivered,
      ...(debugToken ? { debug_verify_token: debugToken } : {})
    }, 201);
  });

  app.get('/api/auth/users', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const userSchema = await getUserSchemaSupport(c.env.DB);

    const fields = [
      'u.id',
      'u.username',
      'u.role',
      'u.created_at',
      'u.updated_at',
      '(SELECT MIN(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS first_login_at',
      '(SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS latest_login_at'
    ];
    if (userSchema.hasEmail) fields.push('email');
    if (userSchema.hasEmailVerifiedAt) fields.push('email_verified_at');
    const { results } = await c.env.DB.prepare(
      `SELECT ${fields.join(', ')} FROM users u ORDER BY u.created_at DESC`
    ).all();

    return c.json(results.map((row) => ({
      id: (row as any).id as string,
      username: (row as any).username as string,
      email: ((row as any).email as string | null) ?? ((row as any).username as string),
      email_verified_at: userSchema.hasEmailVerifiedAt ? (((row as any).email_verified_at as string | null) ?? null) : null,
      first_login_at: ((row as any).first_login_at as string | null) ?? null,
      latest_login_at: ((row as any).latest_login_at as string | null) ?? null,
      role: normalizeRole((row as any).role),
      created_at: (row as any).created_at as string,
      updated_at: (row as any).updated_at as string
    })));
  });

  app.put('/api/auth/users/:id', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const userSchema = await getUserSchemaSupport(c.env.DB);

    const id = c.req.param('id');
    const body = await c.req.json();
    const role = (body as any)?.role as UserRole | undefined;
    const password = typeof (body as any)?.password === 'string' ? (body as any).password : '';
    const hasEmailUpdate = typeof (body as any)?.email === 'string';
    const nextEmail = hasEmailUpdate ? normalizeEmail((body as any).email) : '';
    if (!role && !password && !hasEmailUpdate) {
      return c.json({ error: 'role or password or email is required' }, 400);
    }
    if (hasEmailUpdate && (!nextEmail || !isValidEmail(nextEmail))) {
      return c.json({ error: 'Invalid email format' }, 400);
    }

    const existing = await c.env.DB.prepare(
      `SELECT id, username, role${userSchema.hasEmail ? ', email' : ''} FROM users WHERE id = ?`
    ).bind(id).first();
    if (!existing) {
      return c.json({ error: 'User not found' }, 404);
    }

    const existingRole = normalizeRole((existing as any).role);
    const nextRole = role ? normalizeRole(role) : existingRole;

    if (sessionUser.userId === id && nextRole !== 'admin') {
      return c.json({ error: 'Cannot remove your own admin role' }, 400);
    }

    if (existingRole === 'admin' && nextRole !== 'admin') {
      const remaining = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND id != ?"
      ).bind(id).first();
      const remainingAdmins = Number((remaining as any)?.count ?? 0);
      if (remainingAdmins <= 0) {
        return c.json({ error: 'At least one admin is required' }, 400);
      }
    }

    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = ?'];
    const values: Array<string | null> = [now];
    let delivered = false;

    if (role) {
      updates.push('role = ?');
      values.push(nextRole);
    }

    if (password) {
      const salt = randomBase64(16);
      const passwordHash = await hashPassword(password, salt);
      updates.push('password_hash = ?', 'password_salt = ?');
      values.push(passwordHash, salt);
    }

    if (hasEmailUpdate) {
      const currentEmail = ((existing as any).email as string | null) ?? ((existing as any).username as string);
      if (currentEmail !== nextEmail) {
        const duplicateField = userSchema.hasEmail ? 'email' : 'username';
        const duplicate = await c.env.DB.prepare(
          `SELECT id FROM users WHERE ${duplicateField} = ? AND id != ?`
        ).bind(nextEmail, id).first();
        if (duplicate) {
          return c.json({ error: 'User already exists' }, 409);
        }

        updates.push('username = ?');
        values.push(nextEmail);
        if (userSchema.hasEmail) {
          updates.push('email = ?');
          values.push(nextEmail);
        }
        if (userSchema.hasEmailVerifiedAt) {
          updates.push('email_verified_at = ?');
          values.push(null);
        }
        if (userSchema.hasEmailVerifyTokenHash && userSchema.hasEmailVerifyExpiresAt) {
          const token = await createVerificationToken();
          updates.push('email_verify_token_hash = ?', 'email_verify_expires_at = ?');
          values.push(token.tokenHash, token.expiresAt);
          const verifyUrl = buildVerificationUrl(c.env, token.token);
          delivered = await sendVerificationEmail(c.env, nextEmail, verifyUrl);
        }
      }
    }

    values.push(id);
    await c.env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    const updated = await c.env.DB.prepare(
      `SELECT id, username, role, created_at, updated_at${userSchema.hasEmail ? ', email' : ''}${userSchema.hasEmailVerifiedAt ? ', email_verified_at' : ''} FROM users WHERE id = ?`
    ).bind(id).first();

    notifyUpdate(c, 'user:update', {
      id,
      username: (updated as any).username,
      role: normalizeRole((updated as any).role)
    });
    await recordAuditLog(c, {
      action: 'update',
      resourceType: 'users',
      resourceId: id,
      summary: `更新帳號 ${(updated as any).username}`,
      details: {
        username: (updated as any).username,
        role: normalizeRole((updated as any).role),
        changed_fields: [
          ...(role ? ['role'] : []),
          ...(password ? ['password'] : []),
          ...(hasEmailUpdate ? ['email'] : [])
        ],
        verification_email_sent: delivered
      }
    });

    return c.json({
      id: (updated as any).id as string,
      username: (updated as any).username as string,
      email: ((updated as any).email as string | null) ?? ((updated as any).username as string),
      email_verified_at: userSchema.hasEmailVerifiedAt ? (((updated as any).email_verified_at as string | null) ?? null) : null,
      role: normalizeRole((updated as any).role),
      created_at: (updated as any).created_at as string,
      updated_at: (updated as any).updated_at as string
    });
  });

  app.delete('/api/auth/users/:id', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const id = c.req.param('id');
    if (sessionUser.userId === id) {
      return c.json({ error: 'Cannot delete your own account' }, 400);
    }

    const existing = await c.env.DB.prepare(
      'SELECT id, username, role FROM users WHERE id = ?'
    ).bind(id).first();
    if (!existing) {
      return c.json({ error: 'User not found' }, 404);
    }

    if (normalizeRole((existing as any).role) === 'admin') {
      const remaining = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND id != ?"
      ).bind(id).first();
      const remainingAdmins = Number((remaining as any)?.count ?? 0);
      if (remainingAdmins <= 0) {
        return c.json({ error: 'At least one admin is required' }, 400);
      }
    }

    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();

    notifyUpdate(c, 'user:delete', {
      id,
      username: (existing as any).username as string,
      role: normalizeRole((existing as any).role)
    });
    await recordAuditLog(c, {
      action: 'delete',
      resourceType: 'users',
      resourceId: id,
      summary: `刪除帳號 ${(existing as any).username as string}`,
      details: {
        username: (existing as any).username as string,
        role: normalizeRole((existing as any).role)
      }
    });
    return c.json({ ok: true });
  });
}
