import type { Context, Hono, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from './types';

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

async function getSessionUser(db: D1Database, sessionId: string) {
  const now = new Date().toISOString();
  const row = await db.prepare(
    `SELECT s.id as session_id, s.user_id as user_id, s.expires_at as expires_at,
            u.username as username
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  ).bind(sessionId, now).first();
  if (!row) return null;
  return {
    sessionId: (row as any).session_id as string,
    userId: (row as any).user_id as string,
    username: (row as any).username as string
  };
}

const isSecureRequest = (env: Env) => env.ENVIRONMENT === 'production';

const clearSessionCookie = (c: Context<{ Bindings: Env }>) => {
  const isSecure = isSecureRequest(c.env);
  deleteCookie(c, SESSION_COOKIE, { path: '/', sameSite: isSecure ? 'None' : 'Lax', secure: isSecure });
};

export const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const path = c.req.path;
  if (path.startsWith('/api/auth/login') || path.startsWith('/api/auth/setup')) {
    return next();
  }
  if (path.startsWith('/api/auth/me')) {
    return next();
  }

  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionUser = await getSessionUser(c.env.DB, sessionId);
  if (!sessionUser) {
    clearSessionCookie(c);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
};

export function registerAuthRoutes(app: Hono<{ Bindings: Env }>) {
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
      'INSERT INTO users (id, username, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, username, passwordHash, salt, now, now).run();

    return c.json({ id, username }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json();
    const { username, password } = body as { username?: string; password?: string };
    if (!username || !password) {
      return c.json({ error: 'username and password are required' }, 400);
    }

    const user = await c.env.DB.prepare(
      'SELECT id, username, password_hash, password_salt FROM users WHERE username = ?'
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
    await c.env.DB.prepare(
      'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(sessionId, (user as any).id, now.toISOString(), expiresAt.toISOString()).run();

    const isSecure = isSecureRequest(c.env);
    const sameSite = isSecure ? 'None' : 'Lax';
    setCookie(c, SESSION_COOKIE, sessionId, {
      httpOnly: true,
      path: '/',
      sameSite,
      secure: isSecure,
      expires: expiresAt
    });

    return c.json({ user: { id: (user as any).id, username: (user as any).username } });
  });

  app.post('/api/auth/logout', async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (sessionId) {
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    }
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (!sessionId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sessionUser = await getSessionUser(c.env.DB, sessionId);
    if (!sessionUser) {
      clearSessionCookie(c);
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return c.json({ user: { id: sessionUser.userId, username: sessionUser.username } });
  });
}
