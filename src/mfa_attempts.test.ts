import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claimMfaChallengeAttempt, claimMfaSessionAttempt } from './auth';
import { SqliteD1Database } from './selfhost/sqlite_d1';

const dir = await mkdtemp(path.join(tmpdir(), 'clan-mfa-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));

const MAX_ATTEMPTS = 5;
const future = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

db.rawDb.exec(`
  CREATE TABLE auth_mfa_challenges (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL,
    code_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
    created_at TEXT
  );
  CREATE TABLE auth_mfa_sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
    created_at TEXT
  );
`);

let counter = 0;
const newChallenge = async (expiresAt = future()) => {
  const id = `challenge-${counter += 1}`;
  await db.prepare(
    `INSERT INTO auth_mfa_challenges (id, user_id, email, code_hash, expires_at, attempt_count, max_attempts)
     VALUES (?, 'user-1', 'user@example.com', 'hash', ?, 0, ?)`
  ).bind(id, expiresAt, MAX_ATTEMPTS).run();
  return id;
};

const newSession = async (expiresAt = future()) => {
  const id = `session-${counter += 1}`;
  await db.prepare(
    `INSERT INTO auth_mfa_sessions (id, user_id, email, expires_at, attempt_count, max_attempts)
     VALUES (?, 'user-1', 'user@example.com', ?, 0, ?)`
  ).bind(id, expiresAt, MAX_ATTEMPTS).run();
  return id;
};

const attemptCountOf = async (table: string, id: string) => Number(
  ((await db.prepare(`SELECT attempt_count FROM ${table} WHERE id = ?`).bind(id).first()) as any)?.attempt_count
);

test('a challenge grants exactly max_attempts claims', async () => {
  const id = await newChallenge();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const claimed = await claimMfaChallengeAttempt(db as any, id, new Date().toISOString());
    assert.ok(claimed, `attempt ${attempt} should be claimable`);
    assert.equal(Number((claimed as any).attempt_count), attempt, 'claim returns the post-increment count');
    assert.equal((claimed as any).code_hash, 'hash', 'claim returns the code hash to compare against');
  }

  assert.equal(await claimMfaChallengeAttempt(db as any, id, new Date().toISOString()), null);
  assert.equal(await attemptCountOf('auth_mfa_challenges', id), MAX_ATTEMPTS, 'exhausted claims must not keep incrementing');
});

test('concurrent claims against one challenge cannot exceed max_attempts', async () => {
  const id = await newChallenge();
  const nowIso = new Date().toISOString();

  const claims = await Promise.all(
    Array.from({ length: 50 }, () => claimMfaChallengeAttempt(db as any, id, nowIso))
  );
  const granted = claims.filter(Boolean).length;

  // Read-then-write let every caller observing attempt_count = 0 through,
  // which is what makes a six-digit code brute-forceable.
  assert.equal(granted, MAX_ATTEMPTS, `expected ${MAX_ATTEMPTS} claims, saw ${granted}`);
  assert.equal(await attemptCountOf('auth_mfa_challenges', id), MAX_ATTEMPTS);

  const counts = claims.filter(Boolean).map((claim) => Number((claim as any).attempt_count)).sort();
  assert.deepEqual(counts, [1, 2, 3, 4, 5], 'each granted claim gets a distinct attempt number');
});

test('an expired challenge grants no claims', async () => {
  const id = await newChallenge(past());
  assert.equal(await claimMfaChallengeAttempt(db as any, id, new Date().toISOString()), null);
  assert.equal(await attemptCountOf('auth_mfa_challenges', id), 0);
});

test('an unknown challenge grants no claims', async () => {
  assert.equal(await claimMfaChallengeAttempt(db as any, 'does-not-exist', new Date().toISOString()), null);
});

test('concurrent claims against one TOTP session cannot exceed max_attempts', async () => {
  const id = await newSession();
  const nowIso = new Date().toISOString();

  const claims = await Promise.all(
    Array.from({ length: 50 }, () => claimMfaSessionAttempt(db as any, id, nowIso))
  );
  assert.equal(claims.filter(Boolean).length, MAX_ATTEMPTS);
  assert.equal(await attemptCountOf('auth_mfa_sessions', id), MAX_ATTEMPTS);
});

test('an expired TOTP session grants no claims', async () => {
  const id = await newSession(past());
  assert.equal(await claimMfaSessionAttempt(db as any, id, new Date().toISOString()), null);
});
