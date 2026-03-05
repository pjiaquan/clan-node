const API_BASE = process.env.API_BASE || 'https://clan-node-production.pjiaquan.workers.dev';
const USER = process.env.USERNAME || '';
const PASS = process.env.PASSWORD || '';
const ORIGIN_OVERRIDE = process.env.ORIGIN || '';
const FETCH_TIMEOUT_MS = Number.parseInt(process.env.FETCH_TIMEOUT_MS || '20000', 10);
const DRY_RUN = process.env.DRY_RUN === '1';

if (!USER || !PASS) {
  console.error('Missing credentials. Set USERNAME and PASSWORD.');
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
  if (ORIGIN_OVERRIDE) return ORIGIN_OVERRIDE;
  try {
    return new URL(baseUrl).origin;
  } catch {
    return '';
  }
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
  const setCookie = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return parseSetCookie(setCookie);
};

const fetchPeople = async (baseUrl, cookie) => {
  const origin = resolveOrigin(baseUrl);
  const res = await fetchWithTimeout(`${baseUrl}/api/people`, {
    headers: {
      Cookie: cookie,
      ...(origin ? { Origin: origin } : {})
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch people ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
};

const fetchAvatarStatus = async (baseUrl, cookie, avatarUrl) => {
  const resolved = resolveAvatarUrl(baseUrl, avatarUrl);
  if (!resolved) return 0;
  const headers = {};
  if (cookie && isSameOrigin(resolved, baseUrl)) {
    headers.Cookie = cookie;
  }
  const res = await fetchWithTimeout(resolved, { headers, redirect: 'follow' });
  return res.status;
};

const deletePersonAvatar = async (baseUrl, cookie, personId, avatarId) => {
  const origin = resolveOrigin(baseUrl);
  const res = await fetchWithTimeout(`${baseUrl}/api/people/${personId}/avatars/${avatarId}`, {
    method: 'DELETE',
    headers: {
      Cookie: cookie,
      ...(origin ? { Origin: origin } : {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE /api/people/${personId}/avatars/${avatarId} failed ${res.status}: ${text}`);
  }
};

const clearLegacyAvatarUrl = async (baseUrl, cookie, personId) => {
  const origin = resolveOrigin(baseUrl);
  const res = await fetchWithTimeout(`${baseUrl}/api/people/${personId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      ...(origin ? { Origin: origin } : {})
    },
    body: JSON.stringify({ avatar_url: null })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PUT /api/people/${personId} failed ${res.status}: ${text}`);
  }
};

const run = async () => {
  const cookie = await login(API_BASE, USER, PASS);
  const people = await fetchPeople(API_BASE, cookie);
  const statusCache = new Map();

  let checkedCount = 0;
  let missingCount = 0;
  let deleteCount = 0;
  let clearCount = 0;
  const failures = [];

  for (const person of people) {
    const avatarRows = Array.isArray(person.avatars) ? person.avatars : [];
    const rowUrlSet = new Set(
      avatarRows
        .map((avatar) => avatar?.avatar_url)
        .filter((avatarUrl) => typeof avatarUrl === 'string' && avatarUrl)
    );

    for (const avatar of avatarRows) {
      const avatarUrl = typeof avatar?.avatar_url === 'string' ? avatar.avatar_url : '';
      const avatarId = typeof avatar?.id === 'string' ? avatar.id : '';
      if (!avatarUrl || !avatarId) continue;

      let status = statusCache.get(avatarUrl);
      if (status === undefined) {
        status = await fetchAvatarStatus(API_BASE, cookie, avatarUrl);
        statusCache.set(avatarUrl, status);
      }
      checkedCount += 1;
      if (status !== 404) continue;
      missingCount += 1;

      if (DRY_RUN) {
        console.log(`[dry-run] delete broken avatar row person=${person.id} avatar_id=${avatarId} url=${avatarUrl}`);
        continue;
      }

      try {
        await deletePersonAvatar(API_BASE, cookie, person.id, avatarId);
        deleteCount += 1;
        console.log(`deleted broken avatar row person=${person.id} avatar_id=${avatarId} url=${avatarUrl}`);
      } catch (error) {
        failures.push(`delete ${person.id}/${avatarId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const legacyAvatarUrl = typeof person.avatar_url === 'string' ? person.avatar_url : '';
    if (!legacyAvatarUrl || rowUrlSet.has(legacyAvatarUrl)) {
      continue;
    }

    let status = statusCache.get(legacyAvatarUrl);
    if (status === undefined) {
      status = await fetchAvatarStatus(API_BASE, cookie, legacyAvatarUrl);
      statusCache.set(legacyAvatarUrl, status);
    }
    checkedCount += 1;
    if (status !== 404) continue;
    missingCount += 1;

    if (DRY_RUN) {
      console.log(`[dry-run] clear broken legacy avatar_url person=${person.id} url=${legacyAvatarUrl}`);
      continue;
    }

    try {
      await clearLegacyAvatarUrl(API_BASE, cookie, person.id);
      clearCount += 1;
      console.log(`cleared broken legacy avatar_url person=${person.id} url=${legacyAvatarUrl}`);
    } catch (error) {
      failures.push(`clear legacy ${person.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\nCleanup summary');
  console.log(`- checked avatar refs: ${checkedCount}`);
  console.log(`- missing avatar refs: ${missingCount}`);
  console.log(`- deleted avatar rows: ${deleteCount}`);
  console.log(`- cleared legacy avatar_url: ${clearCount}`);
  console.log(`- mode: ${DRY_RUN ? 'dry-run' : 'apply'}`);

  if (failures.length > 0) {
    console.error(`\nFailures: ${failures.length}`);
    failures.slice(0, 20).forEach((entry) => console.error(`- ${entry}`));
    if (failures.length > 20) {
      console.error(`...and ${failures.length - 20} more.`);
    }
    process.exit(1);
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
