import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkAndConsumeRateLimit } from './auth';
import { SqliteD1Database } from './selfhost/sqlite_d1';

/**
 * Exercises the limiter against a real SQLite engine rather than a mock: the
 * whole point of the change is that the decision is made by one upsert, so the
 * CASE logic and `RETURNING` have to be verified by an engine that actually
 * runs them.
 */
// `ensureAuthRateLimitTable` caches "table exists" in module state, so every
// test shares one database and gets its own bucket key instead.
const dir = await mkdtemp(path.join(tmpdir(), 'clan-ratelimit-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));

const BASE_LIMIT = {
  windowMs: 10 * 60 * 1000,
  maxAttempts: 5,
  blockMs: 15 * 60 * 1000,
};

let bucketCounter = 0;
const newLimit = (action = 'login') => ({
  ...BASE_LIMIT,
  action,
  limiterKey: `user${bucketCounter += 1}@example.com`,
});

const bucket = (limit: { action: string; limiterKey: string }) => db.prepare(
  'SELECT window_start_ms, count, blocked_until_ms FROM auth_rate_limits WHERE action = ? AND limiter_key = ?'
).bind(limit.action, limit.limiterKey).first() as Promise<Record<string, number | null> | null>;

test('allows exactly maxAttempts per window, then blocks', async () => {
  const LIMIT = newLimit();

  for (let attempt = 1; attempt <= LIMIT.maxAttempts; attempt += 1) {
    const result = await checkAndConsumeRateLimit(db as any, LIMIT);
    assert.equal(result.allowed, true, `attempt ${attempt} should be allowed`);
  }
  assert.equal((await bucket(LIMIT))?.count, LIMIT.maxAttempts);

  const blockedResult = await checkAndConsumeRateLimit(db as any, LIMIT);
  assert.equal(blockedResult.allowed, false);
  assert.ok(
    blockedResult.allowed === false && blockedResult.retryAfterSeconds > 0,
    'a blocked result should carry a retry delay'
  );
});

test('staying blocked does not extend the block', async () => {
  const LIMIT = newLimit();
  for (let attempt = 0; attempt <= LIMIT.maxAttempts; attempt += 1) {
    await checkAndConsumeRateLimit(db as any, LIMIT);
  }

  const firstBlock = await bucket(LIMIT);
  assert.ok(firstBlock?.blocked_until_ms, 'bucket should be blocked');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await checkAndConsumeRateLimit(db as any, LIMIT);
    assert.equal(result.allowed, false);
  }

  const afterRetries = await bucket(LIMIT);
  assert.equal(afterRetries?.blocked_until_ms, firstBlock?.blocked_until_ms, 'block must not be pushed out');
  assert.equal(afterRetries?.count, firstBlock?.count, 'blocked attempts must not inflate the count');
});

test('a new window resets the bucket', async () => {
  const LIMIT = newLimit();
  for (let attempt = 0; attempt < LIMIT.maxAttempts; attempt += 1) {
    await checkAndConsumeRateLimit(db as any, LIMIT);
  }

  // Move the window far enough into the past that it has expired.
  await db.prepare(
    'UPDATE auth_rate_limits SET window_start_ms = window_start_ms - ? WHERE action = ? AND limiter_key = ?'
  ).bind(LIMIT.windowMs * 2, LIMIT.action, LIMIT.limiterKey).run();

  const result = await checkAndConsumeRateLimit(db as any, LIMIT);
  assert.equal(result.allowed, true);
  const row = await bucket(LIMIT);
  assert.equal(row?.count, 1, 'count should restart in the new window');
  assert.equal(row?.blocked_until_ms, null);
});

test('an expired block starts a fresh window', async () => {
  const LIMIT = newLimit();
  for (let attempt = 0; attempt <= LIMIT.maxAttempts; attempt += 1) {
    await checkAndConsumeRateLimit(db as any, LIMIT);
  }
  assert.ok((await bucket(LIMIT))?.blocked_until_ms);

  await db.prepare(
    `UPDATE auth_rate_limits
     SET blocked_until_ms = blocked_until_ms - ?, window_start_ms = window_start_ms - ?
     WHERE action = ? AND limiter_key = ?`
  ).bind(LIMIT.blockMs * 2, LIMIT.windowMs * 2, LIMIT.action, LIMIT.limiterKey).run();

  const result = await checkAndConsumeRateLimit(db as any, LIMIT);
  assert.equal(result.allowed, true);
  assert.equal((await bucket(LIMIT))?.count, 1);
});

test('concurrent consumes cannot exceed maxAttempts', async () => {
  const LIMIT = newLimit();
  const burst = 40;

  const results = await Promise.all(
    Array.from({ length: burst }, () => checkAndConsumeRateLimit(db as any, LIMIT))
  );
  const allowed = results.filter((result) => result.allowed).length;

  // The previous SELECT-then-UPDATE implementation let every caller that read
  // the same pre-increment `count` through.
  assert.equal(allowed, LIMIT.maxAttempts, `expected ${LIMIT.maxAttempts} allowed, saw ${allowed}`);
  // Rejected attempts are not counted, so the bucket settles at the cap.
  assert.equal((await bucket(LIMIT))?.count, LIMIT.maxAttempts);
});

test('separate buckets do not interfere', async () => {
  const LIMIT = newLimit();
  for (let attempt = 0; attempt <= LIMIT.maxAttempts; attempt += 1) {
    await checkAndConsumeRateLimit(db as any, LIMIT);
  }

  const otherKey = await checkAndConsumeRateLimit(db as any, { ...LIMIT, limiterKey: 'someone-else@example.com' });
  assert.equal(otherKey.allowed, true);
  const otherAction = await checkAndConsumeRateLimit(db as any, { ...LIMIT, action: 'mfa_verify' });
  assert.equal(otherAction.allowed, true);
});
