const LOCAL_API_BASE = process.env.LOCAL_API_BASE || 'http://localhost:8787';
const REMOTE_API_BASE = process.env.REMOTE_API_BASE || 'https://clan-node-production.pjiaquan.workers.dev';
const LOCAL_USER = process.env.LOCAL_USER || '';
const LOCAL_PASS = process.env.LOCAL_PASS || '';
const REMOTE_USER = process.env.REMOTE_USER || '';
const REMOTE_PASS = process.env.REMOTE_PASS || '';
const FETCH_TIMEOUT_MS = Number.parseInt(process.env.FETCH_TIMEOUT_MS || '20000', 10);
const ORIGIN_OVERRIDE = process.env.ORIGIN || '';
const ORIGIN_LOCAL = process.env.ORIGIN_LOCAL || '';
const ORIGIN_REMOTE = process.env.ORIGIN_REMOTE || '';
const FAIL_ON_MISSING_AVATAR = process.env.FAIL_ON_MISSING_AVATAR === '1';

if (!LOCAL_USER || !LOCAL_PASS || !REMOTE_USER || !REMOTE_PASS) {
  console.error('Missing credentials. Set LOCAL_USER, LOCAL_PASS, REMOTE_USER, REMOTE_PASS.');
  process.exit(1);
}

const parseSetCookie = (setCookieHeaders = []) => {
  const cookies = setCookieHeaders.map((entry) => entry.split(';')[0]).filter(Boolean);
  return cookies.join('; ');
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const resolveOrigin = (baseUrl) => {
  if (baseUrl === LOCAL_API_BASE && ORIGIN_LOCAL) return ORIGIN_LOCAL;
  if (baseUrl === REMOTE_API_BASE && ORIGIN_REMOTE) return ORIGIN_REMOTE;
  if (ORIGIN_OVERRIDE) return ORIGIN_OVERRIDE;
  try {
    return new URL(baseUrl).origin;
  } catch {
    return '';
  }
};

const login = async (baseUrl, username, password) => {
  const origin = resolveOrigin(baseUrl);
  const res = await fetchWithTimeout(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Login failed ${res.status} ${res.statusText}: ${text}`);
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  return parseSetCookie(setCookie);
};

const fetchPeople = async (baseUrl, cookie) => {
  const origin = resolveOrigin(baseUrl);
  const res = await fetchWithTimeout(`${baseUrl}/api/people`, {
    headers: { Cookie: cookie, ...(origin ? { Origin: origin } : {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch people ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
};

const isSameOrigin = (left, right) => {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
};

const resolveAvatarUrl = (baseUrl, avatarUrl) => {
  if (!avatarUrl) return null;
  if (/^https?:\/\//i.test(avatarUrl)) return avatarUrl;
  return `${baseUrl}${avatarUrl}`;
};

const fetchAvatar = async (sourceUrl, baseUrl, cookie) => {
  const headers = {};
  if (cookie && isSameOrigin(sourceUrl, baseUrl)) {
    headers.Cookie = cookie;
  }
  return fetchWithTimeout(sourceUrl, {
    headers,
    redirect: 'follow',
  });
};

const collectAvatarEntries = (person) => {
  const entries = [];
  if (Array.isArray(person.avatars) && person.avatars.length > 0) {
    for (const avatar of person.avatars) {
      if (!avatar?.avatar_url || typeof avatar.avatar_url !== 'string') continue;
      entries.push(avatar.avatar_url);
    }
  }
  if (entries.length === 0 && person.avatar_url) {
    entries.push(person.avatar_url);
  }
  return [...new Set(entries)];
};

const auditSide = async (label, baseUrl, cookie, peopleById) => {
  const missing = [];
  let avatarCount = 0;

  for (const person of peopleById.values()) {
    const avatarUrls = collectAvatarEntries(person);
    avatarCount += avatarUrls.length;
    for (const avatarUrlRaw of avatarUrls) {
      const avatarUrl = resolveAvatarUrl(baseUrl, avatarUrlRaw);
      if (!avatarUrl) continue;
      const res = await fetchAvatar(avatarUrl, baseUrl, cookie);
      if (!res.ok) {
        missing.push({
          id: person.id,
          name: person.name || '',
          status: res.status,
          avatar_url: avatarUrlRaw,
        });
      }
    }
  }

  console.log(`${label}: ${avatarCount} avatars checked, ${missing.length} missing files`);
  return missing;
};

const printList = (title, entries) => {
  console.log(`\n${title}: ${entries.length}`);
  if (entries.length === 0) return;
  entries.slice(0, 50).forEach((entry) => {
    console.log(`- ${entry.id} (${entry.name}) status=${entry.status} url=${entry.avatar_url}`);
  });
  if (entries.length > 50) {
    console.log(`...and ${entries.length - 50} more`);
  }
};

const run = async () => {
  const localCookie = await login(LOCAL_API_BASE, LOCAL_USER, LOCAL_PASS);
  const remoteCookie = await login(REMOTE_API_BASE, REMOTE_USER, REMOTE_PASS);

  const localPeople = await fetchPeople(LOCAL_API_BASE, localCookie);
  const remotePeople = await fetchPeople(REMOTE_API_BASE, remoteCookie);

  const localById = new Map(localPeople.map((person) => [person.id, person]));
  const remoteById = new Map(remotePeople.map((person) => [person.id, person]));

  console.log(`Local people: ${localById.size}`);
  console.log(`Remote people: ${remoteById.size}`);

  const missingLocal = await auditSide('Local avatars', LOCAL_API_BASE, localCookie, localById);
  const missingRemote = await auditSide('Remote avatars', REMOTE_API_BASE, remoteCookie, remoteById);

  const entryKey = (entry) => `${entry.id}|${entry.avatar_url}`;
  const localMissingSet = new Set(missingLocal.map(entryKey));
  const remoteMissingSet = new Set(missingRemote.map(entryKey));

  const missingOnlyLocal = missingLocal.filter((entry) => !remoteMissingSet.has(entryKey(entry)));
  const missingOnlyRemote = missingRemote.filter((entry) => !localMissingSet.has(entryKey(entry)));
  const missingBoth = missingLocal.filter((entry) => remoteMissingSet.has(entryKey(entry)));

  printList('Missing only on local', missingOnlyLocal);
  printList('Missing only on remote', missingOnlyRemote);
  printList('Missing on both sides', missingBoth);

  const totalMissing = missingOnlyLocal.length + missingOnlyRemote.length + missingBoth.length;
  if (totalMissing > 0) {
    console.warn(`\nAvatar audit found ${totalMissing} problematic records.`);
    if (FAIL_ON_MISSING_AVATAR) {
      process.exit(1);
    }
  } else {
    console.log('\nAvatar audit passed.');
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
