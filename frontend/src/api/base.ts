export const isLocalhost = window.location.hostname === 'localhost'
  || window.location.hostname === '127.0.0.1'
  || window.location.hostname.startsWith('192.168.');

export const normalizeApiBase = (value: string) => {
  let next = value.trim().replace(/\/+$/, '');
  if (next.endsWith('/api')) {
    next = next.slice(0, -4);
  }
  return next;
};

// Production Worker, matching functions/api/[[path]].ts and the operational
// scripts. This fallback used to name the default-environment Worker
// (clan-node.pjiaquan.workers.dev), which runs with ENVIRONMENT=development
// against the production database, so any build that forgot to set
// VITE_API_BASE talked to it.
const DEFAULT_API_BASE = 'https://clan-node-production.pjiaquan.workers.dev';

const hasExplicitApiBase = Object.prototype.hasOwnProperty.call(import.meta.env, 'VITE_API_BASE');
const configuredApiBase = hasExplicitApiBase
  ? String(import.meta.env.VITE_API_BASE ?? '')
  : (isLocalhost ? `${window.location.protocol}//${window.location.hostname}:8787` : DEFAULT_API_BASE);

export const API_BASE = normalizeApiBase(configuredApiBase);

/**
 * Resolves a stored avatar path against the API origin.
 *
 * Absolute URLs are refused. They used to be passed through unchanged, and
 * because the graph prefetches every visible person's avatar with
 * `credentials: 'include'`, a writer could point one at a host of their
 * choosing and learn the IP, user agent and viewing time of every other
 * member. The server now rejects them on write; this also covers rows stored
 * before that, and keeps such a URL from being fetched or rendered.
 */
export const resolveAvatarUrl = (avatarUrl: string | null | undefined) => {
  if (!avatarUrl) return null;
  if (!avatarUrl.startsWith('/api/avatars/')) return null;
  return `${API_BASE}${avatarUrl}`;
};

export const fetchWithAuth = (input: RequestInfo | URL, init: RequestInit = {}) => (
  fetch(input, { credentials: 'include', ...init }).then((res) => {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('clan:unauthorized'));
    }
    return res;
  })
);

export const parseErrorMessage = async (res: Response): Promise<string> => {
  try {
    const data = await res.clone().json();
    if (typeof (data as { error?: unknown })?.error === 'string' && (data as { error: string }).error.trim()) {
      return (data as { error: string }).error.trim();
    }
  } catch {
    // fall through to text parser
  }
  try {
    const text = (await res.text()).trim();
    if (text) return text;
  } catch {
    // ignore
  }
  return `HTTP ${res.status}: ${res.statusText}`;
};
