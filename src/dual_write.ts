import type { Context } from 'hono';
import type { AppBindings, Env } from './types';

type RemoteConfig = {
  baseUrl: string;
  origin: string;
  username: string;
  password: string;
};

let cachedCookie: string | null = null;

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

const getRemoteConfig = (env: Env): RemoteConfig | null => {
  const enabled = String(env.DUAL_WRITE_REMOTE || '').toLowerCase();
  if (enabled !== '1' && enabled !== 'true' && enabled !== 'yes') return null;
  const baseUrl = env.DUAL_WRITE_REMOTE_BASE || '';
  const origin = env.DUAL_WRITE_REMOTE_ORIGIN || '';
  const username = env.DUAL_WRITE_REMOTE_USER || '';
  const password = env.DUAL_WRITE_REMOTE_PASS || '';
  if (!baseUrl || !origin || !username || !password) {
    console.warn('Dual-write disabled: missing DUAL_WRITE_REMOTE_BASE/ORIGIN/USER/PASS');
    return null;
  }
  return { baseUrl, origin, username, password };
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
  headers.set('Origin', config.origin);
  headers.set('X-Dual-Write', '1');
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
  c.executionCtx?.waitUntil(executeRemote(c.env, path, init));
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
  c.executionCtx?.waitUntil(executeRemote(c.env, path, init));
};
