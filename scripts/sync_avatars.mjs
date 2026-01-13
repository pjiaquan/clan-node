const LOCAL_API_BASE = process.env.LOCAL_API_BASE || 'http://localhost:8787';
const REMOTE_API_BASE = process.env.REMOTE_API_BASE || 'https://clan-node-production.pjiaquan.workers.dev';
const LOCAL_USER = process.env.LOCAL_USER || '';
const LOCAL_PASS = process.env.LOCAL_PASS || '';
const REMOTE_USER = process.env.REMOTE_USER || '';
const REMOTE_PASS = process.env.REMOTE_PASS || '';

if (!LOCAL_USER || !LOCAL_PASS || !REMOTE_USER || !REMOTE_PASS) {
  console.error('Missing credentials. Set LOCAL_USER, LOCAL_PASS, REMOTE_USER, REMOTE_PASS.');
  process.exit(1);
}

const parseSetCookie = (setCookieHeaders = []) => {
  const cookies = setCookieHeaders.map((entry) => entry.split(';')[0]).filter(Boolean);
  return cookies.join('; ');
};

const login = async (baseUrl, username, password) => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed ${res.status} ${res.statusText}`);
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  return parseSetCookie(setCookie);
};

const fetchPeople = async (baseUrl, cookie) => {
  const res = await fetch(`${baseUrl}/api/people`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch people ${res.status} ${res.statusText}`);
  }
  return res.json();
};

const resolveAvatarUrl = (baseUrl, avatarUrl) => {
  if (!avatarUrl) return null;
  if (/^https?:\/\//i.test(avatarUrl)) return avatarUrl;
  return `${baseUrl}${avatarUrl}`;
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

const uploadAvatar = async (baseUrl, cookie, personId, buffer, contentType, filename) => {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: contentType || 'application/octet-stream' });
  formData.append('file', blob, filename || 'avatar.png');
  const res = await fetch(`${baseUrl}/api/people/${personId}/avatar`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
};

const run = async () => {
  const direction = (process.env.SYNC_DIRECTION || 'local-to-remote').toLowerCase();
  const fromLocal = direction !== 'remote-to-local';
  const fromBase = fromLocal ? LOCAL_API_BASE : REMOTE_API_BASE;
  const toBase = fromLocal ? REMOTE_API_BASE : LOCAL_API_BASE;

  const fromCookie = await login(fromBase, fromLocal ? LOCAL_USER : REMOTE_USER, fromLocal ? LOCAL_PASS : REMOTE_PASS);
  const toCookie = await login(toBase, fromLocal ? REMOTE_USER : LOCAL_USER, fromLocal ? REMOTE_PASS : LOCAL_PASS);

  const people = await fetchPeople(fromBase, fromCookie);
  const withAvatar = people.filter((person) => person.avatar_url);

  console.log(`Found ${withAvatar.length} avatars to sync (${direction}).`);
  const failures = [];

  for (const person of withAvatar) {
    const sourceUrl = resolveAvatarUrl(fromBase, person.avatar_url);
    if (!sourceUrl) continue;
    const res = await fetch(sourceUrl, { headers: { Cookie: fromCookie } });
    if (!res.ok) {
      console.warn(`Skip ${person.id}: failed to fetch avatar (${res.status})`);
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
        await uploadAvatar(toBase, toCookie, person.id, buffer, contentType, filename);
        console.log(`Synced avatar for ${person.id} (${person.name || ''})`);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        console.warn(`Failed avatar upload for ${person.id} (${person.name || ''}) attempt ${attempt}: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      }
    }
    if (lastError) {
      failures.push({ id: person.id, name: person.name || '', error: lastError.message });
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
