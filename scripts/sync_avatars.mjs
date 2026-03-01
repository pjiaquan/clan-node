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
const FAIL_ON_MISSING_SOURCE_AVATAR = process.env.FAIL_ON_MISSING_SOURCE_AVATAR === '1';

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
    throw new Error(`Login failed ${res.status} ${res.statusText}`);
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

const checkAvatarExists = async (baseUrl, cookie, avatarUrl) => {
  const targetUrl = resolveAvatarUrl(baseUrl, avatarUrl);
  if (!targetUrl) return false;
  const res = await fetchAvatar(targetUrl, baseUrl, cookie);
  if (res.status === 404) return false;
  return res.ok;
};

const resolveContentType = (contentType, filename) => {
  if (contentType && contentType !== 'application/octet-stream') {
    return contentType;
  }
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return contentType || 'application/octet-stream';
};

const uploadAvatar = async (baseUrl, cookie, personId, buffer, contentType, filename, setPrimary) => {
  const origin = resolveOrigin(baseUrl);
  const formData = new FormData();
  const blob = new Blob([buffer], { type: contentType || 'application/octet-stream' });
  formData.append('file', blob, filename || 'avatar.png');
  formData.append('set_primary', setPrimary ? '1' : '0');
  const res = await fetchWithTimeout(`${baseUrl}/api/people/${personId}/avatars`, {
    method: 'POST',
    headers: { Cookie: cookie, ...(origin ? { Origin: origin } : {}) },
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
};

const collectAvatarEntries = (person) => {
  const legacyPrimary = typeof person.avatar_url === 'string' ? person.avatar_url : '';
  const entries = [];

  if (Array.isArray(person.avatars) && person.avatars.length > 0) {
    const normalized = person.avatars
      .filter((avatar) => typeof avatar?.avatar_url === 'string' && avatar.avatar_url)
      .map((avatar, index) => ({
        avatar_url: avatar.avatar_url,
        is_primary: avatar.is_primary === true,
        sort_order: Number.isFinite(avatar.sort_order) ? Number(avatar.sort_order) : index,
      }))
      .sort((left, right) => {
        if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1;
        return left.sort_order - right.sort_order;
      });

    let primaryAssigned = false;
    for (const avatar of normalized) {
      const isPrimary = avatar.is_primary || (!primaryAssigned && avatar.avatar_url === legacyPrimary);
      entries.push({ avatar_url: avatar.avatar_url, is_primary: isPrimary });
      if (isPrimary) primaryAssigned = true;
    }
    if (!primaryAssigned && entries.length > 0) {
      entries[0].is_primary = true;
    }
    return entries;
  }

  if (legacyPrimary) {
    entries.push({ avatar_url: legacyPrimary, is_primary: true });
  }
  return entries;
};

const run = async () => {
  const direction = (process.env.SYNC_DIRECTION || 'local-to-remote').toLowerCase();
  const fromLocal = direction !== 'remote-to-local';
  const fromBase = fromLocal ? LOCAL_API_BASE : REMOTE_API_BASE;
  const toBase = fromLocal ? REMOTE_API_BASE : LOCAL_API_BASE;

  const fromCookie = await login(fromBase, fromLocal ? LOCAL_USER : REMOTE_USER, fromLocal ? LOCAL_PASS : REMOTE_PASS);
  const toCookie = await login(toBase, fromLocal ? REMOTE_USER : LOCAL_USER, fromLocal ? REMOTE_PASS : LOCAL_PASS);

  let people;
  try {
    people = await fetchPeople(fromBase, fromCookie);
  } catch (error) {
    if (!fromLocal) {
      console.warn(`Failed to fetch people from remote (${fromBase}). Falling back to local list.`);
      people = await fetchPeople(LOCAL_API_BASE, toCookie);
    } else {
      throw error;
    }
  }

  const avatarEntries = people.flatMap((person) => (
    collectAvatarEntries(person).map((avatar, index) => ({
      person_id: person.id,
      person_name: person.name || '',
      avatar_url: avatar.avatar_url,
      is_primary: avatar.is_primary,
      index,
    }))
  ));

  console.log(`Found ${avatarEntries.length} avatars to sync (${direction}).`);
  const failures = [];
  const missingSource = [];
  let alreadyPresent = 0;

  for (const entry of avatarEntries) {
    const sourceUrl = resolveAvatarUrl(fromBase, entry.avatar_url);
    if (!sourceUrl) continue;
    const res = await fetchAvatar(sourceUrl, fromBase, fromCookie);
    if (!res.ok) {
      let keepExisting = false;
      if (res.status === 404 && fromLocal) {
        keepExisting = await checkAvatarExists(toBase, toCookie, entry.avatar_url);
      }

      if (keepExisting) {
        alreadyPresent += 1;
        console.log(`Keep existing avatar for ${entry.person_id} (${entry.person_name})`);
        continue;
      }

      const reason = `failed to fetch source avatar (${res.status})`;
      missingSource.push({ id: entry.person_id, name: entry.person_name, reason, avatar_url: entry.avatar_url });
      console.warn(`Skip ${entry.person_id}#${entry.index}: ${reason}`);
      continue;
    }
    const buffer = await res.arrayBuffer();
    const rawContentType = res.headers.get('content-type') || 'application/octet-stream';
    const filename = sourceUrl.split('/').pop() || 'avatar.png';
    const contentType = resolveContentType(rawContentType, filename);
    let attempt = 0;
    let lastError;
    while (attempt < 3) {
      attempt += 1;
      try {
        await uploadAvatar(toBase, toCookie, entry.person_id, buffer, contentType, filename, entry.is_primary);
        console.log(`Synced avatar for ${entry.person_id} (${entry.person_name})${entry.is_primary ? ' [primary]' : ''}`);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        console.warn(`Failed avatar upload for ${entry.person_id} (${entry.person_name}) attempt ${attempt}: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      }
    }
    if (lastError) {
      failures.push({ id: entry.person_id, name: entry.person_name, error: lastError.message });
    }
  }

  if (alreadyPresent > 0) {
    console.log(`Reused ${alreadyPresent} avatars already present on destination.`);
  }

  if (missingSource.length > 0) {
    console.warn(`Missing source avatars: ${missingSource.length}`);
    missingSource.slice(0, 10).forEach((entry) => {
      console.warn(`- ${entry.id} ${entry.name}: ${entry.reason} (${entry.avatar_url})`);
    });
    if (missingSource.length > 10) {
      console.warn(`...and ${missingSource.length - 10} more.`);
    }
    if (FAIL_ON_MISSING_SOURCE_AVATAR) {
      process.exit(1);
    }
  }

  if (failures.length > 0) {
    console.error(`Avatar sync completed with ${failures.length} failures.`);
    failures.slice(0, 10).forEach((entry) => {
      console.error(`- ${entry.id} ${entry.name}: ${entry.error}`);
    });
    if (failures.length > 10) {
      console.error(`...and ${failures.length - 10} more.`);
    }
    process.exit(1);
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
