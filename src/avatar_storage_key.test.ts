import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { isSafeStorageKey, isServerMintedAvatarUrl, safeStorageKey } from './storage_keys';
import { LocalR2Bucket } from './selfhost/local_r2';
import { deriveStorageKeyFromUrl } from './people/avatar_service';

const TRAVERSAL_KEYS = [
  '../clan-node.sqlite',
  '../../../etc/passwd',
  '..',
  'a/../../clan-node.sqlite',
  'sub/dir.png',
  'back\\slash.png',
  '/etc/passwd',
  './clan-node.sqlite',
  '',
];

const LEGITIMATE_KEYS = [
  'person-11111111-1111-4111-8111-111111111111-1700000000000-22222222-2222-4222-8222-222222222222.jpg',
  'user-11111111-1111-4111-8111-111111111111-1700000000000-22222222-2222-4222-8222-222222222222.webp',
  'legacy-avatar.png',
];

const DB_CONTENTS = 'SQLite format 3 -- password hashes and TOTP secrets';

test('isSafeStorageKey rejects traversal and accepts server-minted keys', () => {
  for (const key of TRAVERSAL_KEYS) {
    assert.equal(isSafeStorageKey(key), false, `expected ${JSON.stringify(key)} to be rejected`);
    assert.equal(safeStorageKey(key), null);
  }
  for (const key of LEGITIMATE_KEYS) {
    assert.equal(isSafeStorageKey(key), true, `expected ${key} to be accepted`);
    assert.equal(safeStorageKey(key), key);
  }
  assert.equal(isSafeStorageKey(undefined), false);
  assert.equal(isSafeStorageKey(null), false);
  assert.equal(isSafeStorageKey(42), false);
});

test('deriveStorageKeyFromUrl rejects traversal hidden in avatar_url', () => {
  assert.equal(deriveStorageKeyFromUrl('/api/avatars/../clan-node.sqlite'), null);
  assert.equal(deriveStorageKeyFromUrl('/api/avatars/..%2Fclan-node.sqlite'), null);
  assert.equal(deriveStorageKeyFromUrl('https://evil.test/x.png'), null);
  assert.equal(deriveStorageKeyFromUrl(null), null);
  assert.equal(deriveStorageKeyFromUrl(`/api/avatars/${LEGITIMATE_KEYS[0]}`), LEGITIMATE_KEYS[0]);
});

test('LocalR2Bucket cannot read, write or delete outside its root', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'clan-r2-'));
  const avatarsDir = path.join(dataDir, 'avatars');
  await mkdir(avatarsDir, { recursive: true });
  // Mirrors the self-host layout: the SQLite DB is a sibling of the avatar dir.
  const dbPath = path.join(dataDir, 'clan-node.sqlite');
  await writeFile(dbPath, DB_CONTENTS, 'utf8');

  const bucket = new LocalR2Bucket(avatarsDir);

  for (const key of TRAVERSAL_KEYS) {
    assert.equal(await bucket.get(key), null, `get(${JSON.stringify(key)}) should miss`);
    assert.equal(await bucket.head(key), null, `head(${JSON.stringify(key)}) should miss`);
    await assert.rejects(
      () => bucket.put(key, 'overwritten'),
      /invalid storage key/,
      `put(${JSON.stringify(key)}) should be rejected`
    );
    // delete() skips unsafe keys instead of throwing, so one bad DB row cannot
    // break deleting its owning person.
    await bucket.delete(key);
  }

  // The sibling database is still intact and was never served.
  assert.equal(await readFile(dbPath, 'utf8'), DB_CONTENTS);

  // A legitimate key still round-trips.
  const key = LEGITIMATE_KEYS[0];
  await bucket.put(key, 'png-bytes', { httpMetadata: { contentType: 'image/png' } } as any);
  const stored = await bucket.get(key);
  assert.ok(stored, 'legitimate key should be readable');
  await stat(path.join(avatarsDir, key));
  await bucket.delete(key);
  assert.equal(await bucket.get(key), null);
});

test('GET /api/avatars/:key rejects percent-encoded traversal before reaching the bucket', async () => {
  const requestedKeys: string[] = [];
  const app = new Hono();
  // Same shape as the real route in src/people.ts.
  app.get('/api/avatars/:key', async (c) => {
    const key = safeStorageKey(c.req.param('key'));
    if (!key) {
      return c.json({ error: 'Avatar not found' }, 404);
    }
    requestedKeys.push(key);
    return c.json({ served: key });
  });

  for (const encoded of [
    '..%2Fclan-node.sqlite',
    '%2e%2e%2fclan-node.sqlite',
    '..%2F..%2F..%2Fproc%2Fself%2Fenviron',
    '..%5Cclan-node.sqlite',
  ]) {
    const res = await app.request(`http://local.test/api/avatars/${encoded}`);
    assert.equal(res.status, 404, `${encoded} should not be served`);
  }
  assert.deepEqual(requestedKeys, [], 'no traversal key should reach the bucket');

  const res = await app.request(`http://local.test/api/avatars/${LEGITIMATE_KEYS[0]}`);
  assert.equal(res.status, 200);
  assert.deepEqual(requestedKeys, [LEGITIMATE_KEYS[0]]);
});

test('isServerMintedAvatarUrl accepts only paths this server produced', () => {
  assert.equal(isServerMintedAvatarUrl(`/api/avatars/${LEGITIMATE_KEYS[0]}`), true);
  assert.equal(isServerMintedAvatarUrl(`/api/avatars/${LEGITIMATE_KEYS[1]}`), true);

  // The tracking-beacon shapes: any host the writer chooses.
  assert.equal(isServerMintedAvatarUrl('https://attacker.test/p.png'), false);
  assert.equal(isServerMintedAvatarUrl('http://attacker.test/p.png'), false);
  assert.equal(isServerMintedAvatarUrl('//attacker.test/p.png'), false);
  assert.equal(isServerMintedAvatarUrl('https://attacker.test/api/avatars/x.png'), false);
  // Traversal through the prefix.
  assert.equal(isServerMintedAvatarUrl('/api/avatars/../clan-node.sqlite'), false);
  assert.equal(isServerMintedAvatarUrl('/api/avatars/sub/dir.png'), false);
  // Other shapes that are not an avatar path.
  assert.equal(isServerMintedAvatarUrl('/api/people/1'), false);
  assert.equal(isServerMintedAvatarUrl('javascript:alert(1)'), false);
  assert.equal(isServerMintedAvatarUrl('data:image/png;base64,AAAA'), false);
  assert.equal(isServerMintedAvatarUrl('/api/avatars/'), false);
  assert.equal(isServerMintedAvatarUrl(''), false);
  assert.equal(isServerMintedAvatarUrl(null), false);
});
