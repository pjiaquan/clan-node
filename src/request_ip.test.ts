import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { getRequestIpAddress } from './auth';
import type { AppBindings, Env } from './types';

const SPOOFED: Record<string, string> = {
  'CF-Connecting-IP': '203.0.113.9',
  'x-forwarded-for': '203.0.113.9, 10.0.0.1',
};
const SOCKET_ADDRESS = '198.51.100.7';

const app = new Hono<AppBindings>();
app.get('/ip', (c) => c.json({ ip: getRequestIpAddress(c) }));

/**
 * `socketAddress` is supplied per request by the self-host entrypoint; a null
 * one stands for the Cloudflare runtime, which does not set it.
 */
const resolve = async (
  socketAddress: string | null,
  env: Partial<Env>,
  headers: Record<string, string> = SPOOFED
) => {
  const res = await app.request('/ip', { headers }, { ...env, socketAddress } as Env);
  return ((await res.json()) as { ip: string | null }).ip;
};

test('on Cloudflare the edge-set header is used', async () => {
  // No socket address is recorded on Workers, and the edge overwrites
  // CF-Connecting-IP, so it cannot be chosen by the client.
  assert.equal(await resolve(null, {}), '203.0.113.9');
});

test('self-host ignores client-supplied forwarding headers by default', async () => {
  // Rotating CF-Connecting-IP or X-Forwarded-For used to reset every IP-keyed
  // rate limit on a bare Node deployment.
  assert.equal(await resolve(SOCKET_ADDRESS, {}), SOCKET_ADDRESS);
  assert.equal(await resolve(SOCKET_ADDRESS, { TRUSTED_PROXY: '' }), SOCKET_ADDRESS);
  assert.equal(await resolve(SOCKET_ADDRESS, { TRUSTED_PROXY: '0' }), SOCKET_ADDRESS);
  assert.equal(await resolve(SOCKET_ADDRESS, { TRUSTED_PROXY: 'no' }), SOCKET_ADDRESS);
});

test('self-host honours forwarding headers when a proxy is declared', async () => {
  for (const value of ['1', 'true', 'yes', 'YES', ' 1 ']) {
    assert.equal(
      await resolve(SOCKET_ADDRESS, { TRUSTED_PROXY: value }),
      '203.0.113.9',
      `TRUSTED_PROXY=${JSON.stringify(value)} should trust the header`
    );
  }

  // Only the first entry of X-Forwarded-For is taken.
  assert.equal(
    await resolve(SOCKET_ADDRESS, { TRUSTED_PROXY: '1' }, { 'x-forwarded-for': '192.0.2.5, 10.0.0.1' }),
    '192.0.2.5'
  );
  // ...and the socket address is the fallback when the proxy sent nothing.
  assert.equal(await resolve(SOCKET_ADDRESS, { TRUSTED_PROXY: '1' }, {}), SOCKET_ADDRESS);
});
