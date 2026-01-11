const LOCAL_API_BASE = process.env.LOCAL_API_BASE || 'http://localhost:8787';
const LOCAL_USER = process.env.LOCAL_USER || '';
const LOCAL_PASS = process.env.LOCAL_PASS || '';
const REMOTE_API_BASE = process.env.REMOTE_API_BASE || '';
const REMOTE_USER = process.env.REMOTE_USER || '';
const REMOTE_PASS = process.env.REMOTE_PASS || '';

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

const apiPost = async (baseUrl, cookie, path, payload) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed ${res.status} ${res.statusText}: ${text}`, { cause: { status: res.status } });
  }
  return res.json();
};

const siblingKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const runFix = async ({ baseUrl, username, password, label }) => {
  const cookie = await login(baseUrl, username, password);
  const [people, relationships] = await Promise.all([
    apiGet(baseUrl, cookie, '/api/people'),
    apiGet(baseUrl, cookie, '/api/relationships'),
  ]);

  const parentToChildren = new Map();
  const childToParents = new Map();
  const existingSibling = new Set();

  for (const rel of relationships) {
    if (rel.type === 'parent_child') {
      const parent = rel.from_person_id;
      const child = rel.to_person_id;
      if (!parentToChildren.has(parent)) parentToChildren.set(parent, new Set());
      parentToChildren.get(parent).add(child);
      if (!childToParents.has(child)) childToParents.set(child, new Set());
      childToParents.get(child).add(parent);
    }
    if (rel.type === 'sibling') {
      existingSibling.add(siblingKey(rel.from_person_id, rel.to_person_id));
    }
  }

  let createdParentChild = 0;
  let createdSibling = 0;

  const ensureSibling = async (a, b) => {
    if (a === b) return;
    const key = siblingKey(a, b);
    if (existingSibling.has(key)) return;
    try {
    await apiPost(baseUrl, cookie, '/api/relationships', {
        from_person_id: a,
        to_person_id: b,
        type: 'sibling',
        skip_auto_link: true,
      });
      existingSibling.add(key);
      createdSibling += 1;
    } catch (err) {
      if (err?.cause?.status !== 409) throw err;
    }
  };

  const ensureParentChild = async (parent, child) => {
    if (parent === child) return;
    const currentParents = childToParents.get(child) || new Set();
    if (currentParents.has(parent)) return;
    try {
    await apiPost(baseUrl, cookie, '/api/relationships', {
        from_person_id: parent,
        to_person_id: child,
        type: 'parent_child',
        skip_auto_link: true,
      });
      if (!parentToChildren.has(parent)) parentToChildren.set(parent, new Set());
      parentToChildren.get(parent).add(child);
      if (!childToParents.has(child)) childToParents.set(child, new Set());
      childToParents.get(child).add(parent);
      createdParentChild += 1;
    } catch (err) {
      if (err?.cause?.status !== 409) throw err;
    }
  };

  // 1) Ensure siblings for each parent
  for (const [parent, childrenSet] of parentToChildren.entries()) {
    const children = [...childrenSet];
    for (let i = 0; i < children.length; i += 1) {
      for (let j = i + 1; j < children.length; j += 1) {
        await ensureSibling(children[i], children[j]);
      }
    }
  }

  // 2) Ensure parents across existing siblings
  for (const key of existingSibling) {
    const [a, b] = key.split('|');
    const parentsA = childToParents.get(a) || new Set();
    const parentsB = childToParents.get(b) || new Set();
    for (const parent of parentsA) {
      if (!parentsB.has(parent)) {
        await ensureParentChild(parent, b);
      }
    }
    for (const parent of parentsB) {
      if (!parentsA.has(parent)) {
        await ensureParentChild(parent, a);
      }
    }
  }

  // 3) Re-run sibling fill after new parent-child links
  for (const [parent, childrenSet] of parentToChildren.entries()) {
    const children = [...childrenSet];
    for (let i = 0; i < children.length; i += 1) {
      for (let j = i + 1; j < children.length; j += 1) {
        await ensureSibling(children[i], children[j]);
      }
    }
  }

  console.log(`[${label}] Done. Added parent_child: ${createdParentChild}, sibling: ${createdSibling}`);
  console.log(`[${label}] People: ${people.length}, Relationships: ${relationships.length}`);
};

const main = async () => {
  if (!LOCAL_USER || !LOCAL_PASS) {
    console.error('Missing credentials. Set LOCAL_USER and LOCAL_PASS.');
    process.exit(1);
  }

  await runFix({
    baseUrl: LOCAL_API_BASE,
    username: LOCAL_USER,
    password: LOCAL_PASS,
    label: 'local',
  });

  if (REMOTE_API_BASE && REMOTE_USER && REMOTE_PASS) {
    await runFix({
      baseUrl: REMOTE_API_BASE,
      username: REMOTE_USER,
      password: REMOTE_PASS,
      label: 'remote',
    });
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
