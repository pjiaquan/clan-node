import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { notifyUpdate, sendTelegramPayload } from './notify';
import type { AppBindings, Env } from './types';

test('sendTelegramPayload skips if token or chat ID is missing', async () => {
  const originalWarn = console.warn;
  let warnCalled = false;
  console.warn = (...args) => {
    if (args[0].includes('missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID')) {
      warnCalled = true;
    }
  };

  try {
    await sendTelegramPayload({} as Env, { text: 'test', caption: 'test' });
    assert.equal(warnCalled, true, 'console.warn should be called when config is missing');

    warnCalled = false;
    await sendTelegramPayload({ TELEGRAM_BOT_TOKEN: 'token' } as Env, { text: 'test', caption: 'test' });
    assert.equal(warnCalled, true, 'console.warn should be called when chat ID is missing');

    warnCalled = false;
    await sendTelegramPayload({ TELEGRAM_CHAT_ID: 'chat' } as Env, { text: 'test', caption: 'test' });
    assert.equal(warnCalled, true, 'console.warn should be called when token is missing');
  } finally {
    console.warn = originalWarn;
  }
});

test('sendTelegramPayload sends text message via sendMessage endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  let fetchUrl = '';
  let fetchOptions: RequestInit | undefined;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    fetchCallCount++;
    fetchUrl = url.toString();
    fetchOptions = options;
    return new Response('ok', { status: 200 });
  };

  try {
    const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' } as Env;
    await sendTelegramPayload(env, { text: 'hello world', caption: 'caption' });

    assert.equal(fetchCallCount, 1);
    assert.equal(fetchUrl, 'https://api.telegram.org/bottest-token/sendMessage');
    assert.equal(fetchOptions?.method, 'POST');
    assert.deepEqual(JSON.parse(fetchOptions?.body as string), {
      chat_id: 'test-chat',
      text: 'hello world'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendTelegramPayload sends photo via sendPhoto endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  let fetchUrl = '';
  let fetchOptions: RequestInit | undefined;

  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    fetchCallCount++;
    fetchUrl = url.toString();
    fetchOptions = options;
    return new Response('ok', { status: 200 });
  };

  try {
    const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' } as Env;
    await sendTelegramPayload(env, { text: 'text', caption: 'hello photo', photoUrl: 'http://example.com/photo.jpg' });

    assert.equal(fetchCallCount, 1);
    assert.equal(fetchUrl, 'https://api.telegram.org/bottest-token/sendPhoto');
    assert.equal(fetchOptions?.method, 'POST');
    assert.deepEqual(JSON.parse(fetchOptions?.body as string), {
      chat_id: 'test-chat',
      photo: 'http://example.com/photo.jpg',
      caption: 'hello photo'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendTelegramPayload logs warning on non-200 response', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  let fetchCallCount = 0;
  let warnCalled = false;

  globalThis.fetch = async () => {
    fetchCallCount++;
    return new Response('Bad Request', { status: 400 });
  };

  console.warn = (...args) => {
    if (args[0] === 'Telegram notify failed:' && args[1] === 400 && args[2] === 'Bad Request') {
      warnCalled = true;
    }
  };

  try {
    const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' } as Env;
    await sendTelegramPayload(env, { text: 'hello', caption: 'hello' });

    assert.equal(fetchCallCount, 1);
    assert.equal(warnCalled, true, 'console.warn should be called for non-200 response');
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('sendTelegramPayload catches fetch exceptions and logs warning', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  let fetchCallCount = 0;
  let warnCalled = false;

  const mockError = new Error('Network error');

  globalThis.fetch = async () => {
    fetchCallCount++;
    throw mockError;
  };

  console.warn = (...args) => {
    if (args[0] === 'Failed to send Telegram notification:' && args[1] === mockError) {
      warnCalled = true;
    }
  };

  try {
    const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' } as Env;
    await sendTelegramPayload(env, { text: 'hello', caption: 'hello' });

    assert.equal(fetchCallCount, 1);
    assert.equal(warnCalled, true, 'console.warn should be called for fetch exception');
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('notifyUpdate reports the resolved client address, not a spoofed header', async () => {
  const originalFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = async (_url: string | URL | Request, options?: RequestInit) => {
    sent.push(JSON.parse(options?.body as string).text);
    return new Response('ok', { status: 200 });
  };

  try {
    const pending: Promise<unknown>[] = [];
    const app = new Hono<AppBindings>();
    app.post('/api/x', (c) => {
      notifyUpdate(c, 'test:event');
      return c.text('ok');
    });
    // A self-host request (socketAddress set, no TRUSTED_PROXY) carrying a
    // client-chosen CF-Connecting-IP.
    const env = {
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_CHAT_ID: 'test-chat',
      socketAddress: '198.51.100.7',
    } as Env;
    const executionCtx = {
      waitUntil: (p: Promise<unknown>) => { pending.push(p); },
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    await app.request('/api/x', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.9' },
    }, env, executionCtx);
    await Promise.all(pending);

    assert.equal(sent.length, 1);
    assert.match(sent[0], /^IP: 198\.51\.100\.7$/m);
    assert.doesNotMatch(sent[0], /203\.0\.113\.9/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
