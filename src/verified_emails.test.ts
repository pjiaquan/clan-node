import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeEmailList, queryVerifiedEmails } from './d1_repositories';
import { SqliteD1Database } from './selfhost/sqlite_d1';

const schemaSql = await readFile(path.resolve('migrations/schema.sql'), 'utf8');
const dir = await mkdtemp(path.join(tmpdir(), 'clan-emails-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));
db.rawDb.exec(schemaSql);

test('the verified-email lookup is chunked rather than one giant IN clause', async () => {
  // More addresses than fit in one chunk, mixed case and padded, with
  // duplicates -- the normalizer has to fold those before chunking.
  const emails: string[] = [];
  for (let i = 0; i < 120; i += 1) emails.push(` Member${i}@Example.COM `);
  emails.push(' member0@example.com ');

  const normalized = normalizeEmailList(emails);
  assert.equal(normalized.length, 120, 'duplicates and casing are folded');

  for (const email of ['member3@example.com', 'member77@example.com', 'member119@example.com']) {
    await db.prepare(
      `INSERT INTO users (id, username, email, email_verified_at, password_hash, password_salt, role)
       VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z', 'x', 'y', 'readonly')`
    ).bind(`u-${email}`, email, email).run();
  }
  // One verified-looking row that must not match: no verification timestamp.
  await db.prepare(
    `INSERT INTO users (id, username, email, email_verified_at, password_hash, password_salt, role)
     VALUES ('u-unverified', 'member4@example.com', 'member4@example.com', NULL, 'x', 'y', 'readonly')`
  ).run();

  const found = await queryVerifiedEmails(db as any, normalized);
  assert.deepEqual(
    [...found.keys()].sort(),
    ['member119@example.com', 'member3@example.com', 'member77@example.com']
  );
  assert.equal(found.has('member4@example.com'), false, 'an unverified account must not match');

  assert.equal((await queryVerifiedEmails(db as any, [])).size, 0);
});
