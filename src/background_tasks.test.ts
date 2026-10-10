import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { backgroundScheduler, runInBackground, tryExecutionCtx } from './background';
import type { AppBindings } from './types';

/**
 * Hono's `c.executionCtx` getter throws when the context has none. The
 * Cloudflare runtime always supplies one, but the self-hosted Node server
 * calls `app.fetch(request, env)` with no third argument -- so every
 * `if (c.executionCtx)` and `c.executionCtx?.waitUntil(...)` threw there, and
 * the routes that schedule background work answered 500 on self-host. Optional
 * chaining did not help: the getter runs before it.
 */
const buildApp = () => {
  const app = new Hono<AppBindings>();
  app.get('/probe', (c) => c.json({ ctx: tryExecutionCtx(c) === null ? 'absent' : 'present' }));
  app.get('/background', async (c) => {
    runInBackground(c, Promise.resolve('done'), 'probe');
    return c.json({ ok: true });
  });
  app.get('/rejecting', async (c) => {
    runInBackground(c, Promise.reject(new Error('expected failure')), 'probe');
    return c.json({ ok: true });
  });
  app.get('/scheduler', async (c) => {
    backgroundScheduler(c, 'probe')(Promise.resolve('done'));
    return c.json({ ok: true });
  });
  return app;
};

test('the missing execution context is reported, not thrown', async () => {
  const res = await buildApp().request('/probe');
  assert.equal(res.status, 200, 'reading the context must not throw');
  assert.equal((await res.json() as any).ctx, 'absent');
});

test('scheduling background work succeeds without an execution context', async () => {
  for (const route of ['/background', '/scheduler']) {
    const res = await buildApp().request(route);
    assert.equal(res.status, 200, `${route} must not fail`);
    assert.deepEqual(await res.json(), { ok: true });
  }
});

test('a rejected background task does not fail the response', async () => {
  const res = await buildApp().request('/rejecting');
  assert.equal(res.status, 200);
  // Give the guarded catch a turn, so a rejection cannot surface as an
  // unhandled one after the response.
  await new Promise((resolve) => setImmediate(resolve));
});

test('waitUntil is used when an execution context is present', async () => {
  const scheduled: Promise<unknown>[] = [];
  const executionCtx = {
    waitUntil: (promise: Promise<unknown>) => { scheduled.push(promise); },
    passThroughOnException: () => undefined,
  };

  const res = await buildApp().request('/background', {}, {}, executionCtx as any);
  assert.equal(res.status, 200);
  assert.equal(scheduled.length, 1, 'the task should be handed to waitUntil');
  await scheduled[0];
});
