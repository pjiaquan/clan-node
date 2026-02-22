const LOCAL_API_BASE = process.env.LOCAL_API_BASE || 'http://localhost:8787';
const REMOTE_API_BASE = process.env.REMOTE_API_BASE || 'https://clan-node-production.pjiaquan.workers.dev';
const LOCAL_USER = process.env.LOCAL_USER || '';
const LOCAL_PASS = process.env.LOCAL_PASS || '';
const REMOTE_USER = process.env.REMOTE_USER || '';
const REMOTE_PASS = process.env.REMOTE_PASS || '';
const ORIGIN_OVERRIDE = process.env.ORIGIN || '';
const ORIGIN_LOCAL = process.env.ORIGIN_LOCAL || '';
const ORIGIN_REMOTE = process.env.ORIGIN_REMOTE || '';

if (!LOCAL_USER || !LOCAL_PASS || !REMOTE_USER || !REMOTE_PASS) {
  console.error('Missing credentials. Set LOCAL_USER, LOCAL_PASS, REMOTE_USER, REMOTE_PASS.');
  process.exit(1);
}

const parseSetCookie = (setCookieHeaders = []) => {
  const cookies = setCookieHeaders.map((entry) => entry.split(';')[0]).filter(Boolean);
  return cookies.join('; ');
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
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed ${res.status} ${res.statusText}: ${text}`);
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  return parseSetCookie(setCookie);
};

const apiGet = async (baseUrl, cookie, path) => {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
};

const apiPost = async (baseUrl, cookie, path, payload, { allowConflict = false } = {}) => {
  const origin = resolveOrigin(baseUrl);
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(payload),
  });
  if (allowConflict && res.status === 409) {
    return null;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
};

const apiPut = async (baseUrl, cookie, path, payload) => {
  const origin = resolveOrigin(baseUrl);
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} failed ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
};

const toTimestamp = (value) => {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? 0 : ts;
};

const normalizeMeta = (meta) => JSON.stringify(meta ?? null);

const mergePeople = async (local, remote) => {
  const localMap = new Map(local.people.map((person) => [person.id, person]));
  const remoteMap = new Map(remote.people.map((person) => [person.id, person]));
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()]);

  for (const id of ids) {
    const localPerson = localMap.get(id);
    const remotePerson = remoteMap.get(id);

    if (localPerson && !remotePerson) {
      await apiPost(remote.baseUrl, remote.cookie, '/api/people', {
        id: localPerson.id,
        name: localPerson.name,
        english_name: localPerson.english_name ?? null,
        gender: localPerson.gender,
        dob: localPerson.dob,
        dod: localPerson.dod,
        tob: localPerson.tob,
        tod: localPerson.tod,
        avatar_url: localPerson.avatar_url ?? null,
        metadata: localPerson.metadata ?? null,
      });
      console.log(`Created remote person ${localPerson.id}`);
      continue;
    }

    if (!localPerson && remotePerson) {
      await apiPost(local.baseUrl, local.cookie, '/api/people', {
        id: remotePerson.id,
        name: remotePerson.name,
        english_name: remotePerson.english_name ?? null,
        gender: remotePerson.gender,
        dob: remotePerson.dob,
        dod: remotePerson.dod,
        tob: remotePerson.tob,
        tod: remotePerson.tod,
        avatar_url: remotePerson.avatar_url ?? null,
        metadata: remotePerson.metadata ?? null,
      });
      console.log(`Created local person ${remotePerson.id}`);
      continue;
    }

    if (!localPerson || !remotePerson) continue;

    const localTs = toTimestamp(localPerson.updated_at || localPerson.created_at);
    const remoteTs = toTimestamp(remotePerson.updated_at || remotePerson.created_at);

    if (localTs > remoteTs) {
      await apiPut(remote.baseUrl, remote.cookie, `/api/people/${localPerson.id}`, {
        name: localPerson.name,
        english_name: localPerson.english_name ?? null,
        gender: localPerson.gender,
        dob: localPerson.dob,
        dod: localPerson.dod,
        tob: localPerson.tob,
        tod: localPerson.tod,
        avatar_url: localPerson.avatar_url ?? null,
        metadata: localPerson.metadata ?? null,
      });
      console.log(`Updated remote person ${localPerson.id}`);
    } else if (remoteTs > localTs) {
      await apiPut(local.baseUrl, local.cookie, `/api/people/${remotePerson.id}`, {
        name: remotePerson.name,
        english_name: remotePerson.english_name ?? null,
        gender: remotePerson.gender,
        dob: remotePerson.dob,
        dod: remotePerson.dod,
        tob: remotePerson.tob,
        tod: remotePerson.tod,
        avatar_url: remotePerson.avatar_url ?? null,
        metadata: remotePerson.metadata ?? null,
      });
      console.log(`Updated local person ${remotePerson.id}`);
    }
  }
};

const relationshipKey = (rel) => `${rel.from_person_id}|${rel.to_person_id}|${rel.type}`;

const mergeRelationships = async (local, remote) => {
  const localMap = new Map(local.relationships.map((rel) => [relationshipKey(rel), rel]));
  const remoteMap = new Map(remote.relationships.map((rel) => [relationshipKey(rel), rel]));
  const keys = new Set([...localMap.keys(), ...remoteMap.keys()]);

  for (const key of keys) {
    const localRel = localMap.get(key);
    const remoteRel = remoteMap.get(key);

    if (localRel && !remoteRel) {
      const created = await apiPost(remote.baseUrl, remote.cookie, '/api/relationships', {
        from_person_id: localRel.from_person_id,
        to_person_id: localRel.to_person_id,
        type: localRel.type,
        metadata: localRel.metadata ?? null,
        skipAutoLink: true,
      }, { allowConflict: true });
      if (created) {
        console.log(`Created remote relationship ${key}`);
      } else {
        console.log(`Skipped existing remote relationship ${key}`);
      }
      continue;
    }

    if (!localRel && remoteRel) {
      const created = await apiPost(local.baseUrl, local.cookie, '/api/relationships', {
        from_person_id: remoteRel.from_person_id,
        to_person_id: remoteRel.to_person_id,
        type: remoteRel.type,
        metadata: remoteRel.metadata ?? null,
        skipAutoLink: true,
      }, { allowConflict: true });
      if (created) {
        console.log(`Created local relationship ${key}`);
      } else {
        console.log(`Skipped existing local relationship ${key}`);
      }
      continue;
    }

    if (!localRel || !remoteRel) continue;

    const localMeta = normalizeMeta(localRel.metadata);
    const remoteMeta = normalizeMeta(remoteRel.metadata);
    if (localMeta === remoteMeta) continue;

    const localTs = toTimestamp(localRel.created_at);
    const remoteTs = toTimestamp(remoteRel.created_at);

    if (localTs >= remoteTs) {
      await apiPut(remote.baseUrl, remote.cookie, `/api/relationships/${remoteRel.id}`, {
        metadata: localRel.metadata ?? null,
      });
      console.log(`Updated remote relationship ${key}`);
    } else {
      await apiPut(local.baseUrl, local.cookie, `/api/relationships/${localRel.id}`, {
        metadata: remoteRel.metadata ?? null,
      });
      console.log(`Updated local relationship ${key}`);
    }
  }
};

const run = async () => {
  const localCookie = await login(LOCAL_API_BASE, LOCAL_USER, LOCAL_PASS);
  const remoteCookie = await login(REMOTE_API_BASE, REMOTE_USER, REMOTE_PASS);

  const [localPeople, remotePeople] = await Promise.all([
    apiGet(LOCAL_API_BASE, localCookie, '/api/people'),
    apiGet(REMOTE_API_BASE, remoteCookie, '/api/people'),
  ]);

  const [localRelationships, remoteRelationships] = await Promise.all([
    apiGet(LOCAL_API_BASE, localCookie, '/api/relationships'),
    apiGet(REMOTE_API_BASE, remoteCookie, '/api/relationships'),
  ]);

  const local = { baseUrl: LOCAL_API_BASE, cookie: localCookie, people: localPeople, relationships: localRelationships };
  const remote = { baseUrl: REMOTE_API_BASE, cookie: remoteCookie, people: remotePeople, relationships: remoteRelationships };

  await mergePeople(local, remote);
  await mergeRelationships(local, remote);

  console.log('Merge complete.');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
