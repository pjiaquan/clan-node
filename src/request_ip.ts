import type { Context } from 'hono';
import type { AppBindings, Env } from './types';

const forwardedIpIsTrusted = (env: Env) => (
  ['1', 'true', 'yes'].includes((env.TRUSTED_PROXY || '').trim().toLowerCase())
);

const forwardedIpHeader = (c: Context<AppBindings>) => {
  const cfIp = c.req.header('CF-Connecting-IP') || c.req.header('cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwarded = c.req.header('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || null;
};

/**
 * The client address used for rate-limit keys, session records and audit
 * entries.
 *
 * `CF-Connecting-IP` and `X-Forwarded-For` used to be trusted unconditionally.
 * That is correct on the Cloudflare edge, which overwrites CF-Connecting-IP,
 * but the self-hosted server is a bare Node listener where both headers are
 * whatever the client sent -- so IP-keyed limiters on registration, login and
 * MFA could be bypassed by rotating a header, and the `ip:email` limiters
 * turned into unlimited mail to one victim. Forwarded headers are now honoured
 * only where something in front is known to set them.
 */
export const getRequestIpAddress = (c: Context<AppBindings>) => {
  const socketAddress = c.env.socketAddress ?? null;
  // No socket address means the Cloudflare runtime, where the edge sets
  // CF-Connecting-IP and overwrites any client-supplied value.
  if (!socketAddress) {
    return forwardedIpHeader(c);
  }
  if (forwardedIpIsTrusted(c.env)) {
    return forwardedIpHeader(c) || socketAddress;
  }
  return socketAddress;
};
