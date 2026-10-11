import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app as workerApp } from './index';
import { createSelfhostApp, FRONTEND_CSP } from './selfhost/app';
import { SqliteD1Database } from './selfhost/sqlite_d1';
import type { Env } from './types';

/**
 * The self-hosted server mounts the whole API app at '/' and serves the
 * frontend behind it, so the API's `default-src 'none'` used to land on the
 * HTML, JS and CSS as well and the browser rendered a blank page. Build the
 * real self-host app over a real SQLite database and a stand-in dist.
 */
const STRICT_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

const schemaSql = await readFile(path.resolve('migrations/schema.sql'), 'utf8');
const dir = await mkdtemp(path.join(tmpdir(), 'clan-selfhost-csp-'));
const db = new SqliteD1Database(path.join(dir, 'test.sqlite'));
db.rawDb.exec(schemaSql);

const distRoot = path.join(dir, 'dist');
await mkdir(path.join(distRoot, 'assets'), { recursive: true });
await writeFile(path.join(distRoot, 'index.html'), '<!doctype html><div id="root"></div>');
await writeFile(path.join(distRoot, 'assets', 'index.js'), 'console.log(1);');

const selfhostApp = createSelfhostApp(distRoot);
const env = { DB: db as unknown as D1Database, AVATARS: {} as any, ENVIRONMENT: 'development' } as Env;

test('the frontend document carries the frontend CSP, not the API one', async () => {
  const res = await selfhostApp.request('/', {}, env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.doesNotMatch(csp, /default-src 'none'/);
  assert.equal(csp, FRONTEND_CSP);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
});

test('assets and SPA fallback routes carry the frontend CSP', async () => {
  for (const url of ['/assets/index.js', '/people/some-client-route']) {
    const res = await selfhostApp.request(url, {}, env);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get('content-security-policy'), FRONTEND_CSP, url);
  }
});

test('API responses keep the strict CSP', async () => {
  for (const url of ['/api/people', '/api/auth/me', '/healthz']) {
    const res = await selfhostApp.request(url, {}, env);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/, url);
    assert.equal(res.headers.get('content-security-policy'), STRICT_CSP, url);
  }
});

test('the Worker still sends the strict CSP on every response', async () => {
  for (const url of ['/', '/healthz', '/api/people']) {
    const res = await workerApp.request(url, {}, env);
    assert.equal(res.headers.get('content-security-policy'), STRICT_CSP, url);
  }
});

test('the self-host CSP is the Pages CSP with a same-origin connect-src', async () => {
  const headers = await readFile(path.resolve('frontend/public/_headers'), 'utf8');
  const pagesCsp = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1]?.trim();
  assert.ok(pagesCsp, 'frontend/public/_headers has no Content-Security-Policy');
  const expected = pagesCsp.replace(/connect-src [^;]+/, "connect-src 'self'");
  assert.equal(FRONTEND_CSP, expected);
});
