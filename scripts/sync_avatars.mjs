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
  const localCookie = await login(LOCAL_API_BASE, LOCAL_USER, LOCAL_PASS);
  const remoteCookie = await login(REMOTE_API_BASE, REMOTE_USER, REMOTE_PASS);

  const people = await fetchPeople(LOCAL_API_BASE, localCookie);
  const withAvatar = people.filter((person) => person.avatar_url);

  console.log(`Found ${withAvatar.length} avatars to sync.`);

  for (const person of withAvatar) {
    const sourceUrl = resolveAvatarUrl(LOCAL_API_BASE, person.avatar_url);
    if (!sourceUrl) continue;
    const res = await fetch(sourceUrl, { headers: { Cookie: localCookie } });
    if (!res.ok) {
      console.warn(`Skip ${person.id}: failed to fetch avatar (${res.status})`);
      continue;
    }
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/png';
    const filename = sourceUrl.split('/').pop() || 'avatar.png';
    await uploadAvatar(REMOTE_API_BASE, remoteCookie, person.id, buffer, contentType, filename);
    console.log(`Synced avatar for ${person.id} (${person.name || ''})`);
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
