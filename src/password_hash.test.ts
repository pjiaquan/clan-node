import test from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD_HASH_ITERATIONS, hashPassword, verifyPassword } from './auth';

const PASSWORD = 'Correct Horse Battery Staple 9!';
const SALT = 'DEr8xCDlZ0kqK3hdMQxLsQ==';
const LEGACY_ITERATIONS = 100000;
const CURRENT_ITERATIONS = 100000;
/** deriveBits on Workers throws NotSupportedError above this; Node does not. */
const WORKERS_PBKDF2_MAX_ITERATIONS = 100000;

test('the hash cost stays within what the Workers runtime supports', () => {
  // Node accepts any count, so nothing else here would notice a value that
  // makes every hash on Workers throw.
  assert.ok(PASSWORD_HASH_ITERATIONS <= WORKERS_PBKDF2_MAX_ITERATIONS);
});

test('a new hash records its cost and verifies without needing a rewrite', async () => {
  const stored = await hashPassword(PASSWORD, SALT);
  assert.match(stored, new RegExp(`^pbkdf2-sha256\\$${CURRENT_ITERATIONS}\\$.+$`));

  const result = await verifyPassword(PASSWORD, SALT, stored);
  assert.equal(result.ok, true);
  assert.equal(result.needsRehash, false);
});

test('a legacy bare-base64 hash still verifies and is flagged for rewrite', async () => {
  // What the previous implementation wrote: the raw base64 digest at 100k.
  const legacyStored = (await hashPassword(PASSWORD, SALT, LEGACY_ITERATIONS)).split('$')[2];
  assert.doesNotMatch(legacyStored, /\$/);

  const result = await verifyPassword(PASSWORD, SALT, legacyStored);
  assert.equal(result.ok, true, 'existing accounts must not be locked out');
  assert.equal(result.needsRehash, true, 'and must be rewritten in the self-describing format');
});

test('a rewritten legacy hash verifies without another rewrite', async () => {
  const legacyStored = (await hashPassword(PASSWORD, SALT, LEGACY_ITERATIONS)).split('$')[2];
  assert.equal((await verifyPassword(PASSWORD, SALT, legacyStored)).needsRehash, true);

  const upgraded = await hashPassword(PASSWORD, SALT);
  const result = await verifyPassword(PASSWORD, SALT, upgraded);
  assert.equal(result.ok, true);
  assert.equal(result.needsRehash, false);
});

test('the wrong password fails at either cost', async () => {
  const stored = await hashPassword(PASSWORD, SALT);
  const legacyStored = (await hashPassword(PASSWORD, SALT, LEGACY_ITERATIONS)).split('$')[2];

  assert.equal((await verifyPassword('wrong', SALT, stored)).ok, false);
  assert.equal((await verifyPassword('wrong', SALT, legacyStored)).ok, false);
  // A matching digest under a different salt must not verify.
  assert.equal((await verifyPassword(PASSWORD, 'another-salt', stored)).ok, false);
});

test('a hash claiming a lower cost does not verify a digest made at a higher one', async () => {
  const stored = await hashPassword(PASSWORD, SALT);
  const digest = stored.split('$')[2];

  // Rewriting the iteration count in the stored value changes what is derived,
  // so an attacker with database write access cannot downgrade the KDF into
  // accepting a cheaply-derived digest.
  const downgraded = `pbkdf2-sha256$1000$${digest}`;
  assert.equal((await verifyPassword(PASSWORD, SALT, downgraded)).ok, false);
});

test('malformed stored hashes are rejected, not treated as a match', async () => {
  for (const malformed of [
    '',
    'pbkdf2-sha256$',
    'pbkdf2-sha256$600000$',
    'pbkdf2-sha256$notanumber$abc',
    'pbkdf2-sha256$600000$abc$extra',
    null,
    undefined,
    42,
  ]) {
    const result = await verifyPassword(PASSWORD, SALT, malformed);
    assert.equal(result.ok, false, `${JSON.stringify(malformed)} must not verify`);
    assert.equal(result.needsRehash, false);
  }
});

test('the invite-pending sentinel never verifies', async () => {
  assert.equal((await verifyPassword(PASSWORD, '__invite_pending__', '__invite_pending__')).ok, false);
});
