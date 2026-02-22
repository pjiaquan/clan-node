import type { Context, Hono, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppBindings, Env, UserRole } from './types';
import { notifyUpdate } from './notify';

const SESSION_COOKIE = 'clan_session';
const textEncoder = new TextEncoder();

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

const normalizeRole = (value: unknown): UserRole => (value === 'admin' ? 'admin' : 'readonly');

type SessionSchemaSupport = {
  hasUserAgent: boolean;
  hasIpAddress: boolean;
  hasLastSeenAt: boolean;
};

let sessionSchemaSupportCache: SessionSchemaSupport | null = null;

const getSessionSchemaSupport = async (db: D1Database): Promise<SessionSchemaSupport> => {
  if (sessionSchemaSupportCache) return sessionSchemaSupportCache;
  const { results } = await db.prepare("PRAGMA table_info('sessions')").all();
  const names = new Set(
    results
      .map((row) => (row as any).name as string)
      .filter(Boolean)
  );
  sessionSchemaSupportCache = {
    hasUserAgent: names.has('user_agent'),
    hasIpAddress: names.has('ip_address'),
    hasLastSeenAt: names.has('last_seen_at')
  };
  return sessionSchemaSupportCache;
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
  if (path.startsWith('/api/auth/login') || path.startsWith('/api/auth/setup')) {
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
    if (schema.hasLastSeenAt) {
      await c.env.DB.prepare(
        'UPDATE sessions SET last_seen_at = ? WHERE id = ?'
      ).bind(new Date().toISOString(), sessionUser.sessionId).run();
    }
  } catch (error) {
    console.warn('Failed to update session last_seen_at:', error);
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
    || path.startsWith('/api/auth/logout')
    || path.startsWith('/api/auth/sessions')
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
  app.post('/api/auth/setup', async (c) => {
    const token = c.req.header('x-setup-token') || '';
    if (!c.env.ADMIN_SETUP_TOKEN || token !== c.env.ADMIN_SETUP_TOKEN) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const existing = await c.env.DB.prepare('SELECT id FROM users LIMIT 1').first();
    if (existing) {
      return c.json({ error: 'Admin already exists' }, 409);
    }

    const body = await c.req.json();
    const { username, password } = body as { username?: string; password?: string };
    if (!username || !password) {
      return c.json({ error: 'username and password are required' }, 400);
    }

    const id = crypto.randomUUID();
    const salt = randomBase64(16);
    const passwordHash = await hashPassword(password, salt);
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, password_salt, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, username, passwordHash, salt, 'admin', now, now).run();

    notifyUpdate(c, 'user:setup', {
      id,
      username,
      role: 'admin'
    });
    return c.json({ id, username }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json();
    const { username, password } = body as { username?: string; password?: string };
    if (!username || !password) {
      return c.json({ error: 'username and password are required' }, 400);
    }

    const user = await c.env.DB.prepare(
      'SELECT id, username, password_hash, password_salt, role FROM users WHERE username = ?'
    ).bind(username).first();
    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
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
        role: normalizeRole((user as any).role)
      }
    });
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
    return c.json({ ok: true, deleted: Number(result.meta?.changes ?? 0) });
  });

  app.post('/api/auth/users', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const body = await c.req.json();
    const { username, password, role } = body as { username?: string; password?: string; role?: UserRole };
    if (!username || !password) {
      return c.json({ error: 'username and password are required' }, 400);
    }

    const finalRole: UserRole = role === 'admin' ? 'admin' : 'readonly';
    const existing = await c.env.DB.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).bind(username).first();
    if (existing) {
      return c.json({ error: 'User already exists' }, 409);
    }

    const id = crypto.randomUUID();
    const salt = randomBase64(16);
    const passwordHash = await hashPassword(password, salt);
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, password_salt, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, username, passwordHash, salt, finalRole, now, now).run();

    notifyUpdate(c, 'user:create', {
      id,
      username,
      role: finalRole
    });
    return c.json({ id, username, role: finalRole }, 201);
  });

  app.get('/api/auth/users', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const { results } = await c.env.DB.prepare(
      'SELECT id, username, role, created_at, updated_at FROM users ORDER BY created_at DESC'
    ).all();

    return c.json(results.map((row) => ({
      id: (row as any).id as string,
      username: (row as any).username as string,
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

    const id = c.req.param('id');
    const body = await c.req.json();
    const { role, password } = body as { role?: UserRole; password?: string };
    if (!role && !password) {
      return c.json({ error: 'role or password is required' }, 400);
    }

    const existing = await c.env.DB.prepare(
      'SELECT id, username, role FROM users WHERE id = ?'
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
    const values: Array<string> = [now];

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

    values.push(id);
    await c.env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    const updated = await c.env.DB.prepare(
      'SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?'
    ).bind(id).first();

    notifyUpdate(c, 'user:update', {
      id,
      username: (updated as any).username,
      role: normalizeRole((updated as any).role)
    });

    return c.json({
      id: (updated as any).id as string,
      username: (updated as any).username as string,
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
    return c.json({ ok: true });
  });
}
