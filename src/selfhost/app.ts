import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { app } from '../index';
import type { AppBindings } from '../types';

/**
 * The frontend's policy, from frontend/public/_headers (which only Cloudflare
 * Pages reads), except that connect-src is just 'self': here the API is
 * served from the same origin as the page. A test keeps the two in step.
 */
export const FRONTEND_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// Responses that come from the API app keep its strict default-src 'none'.
// Anything under /api/ stays strict whatever it turns out to be, so an
// uploaded avatar served as HTML can never pick up the frontend's policy.
const isApiPath = (requestPath: string) =>
  requestPath === '/api' || requestPath.startsWith('/api/') || requestPath === '/healthz';

/**
 * The API app mounted at '/' with the built frontend behind it. The API's
 * global middleware runs for every request, frontend assets included, so the
 * outermost middleware swaps its document-hostile CSP for the frontend's on
 * everything that is not an API response.
 */
export const createSelfhostApp = (distRoot: string) => {
  const nodeApp = new Hono<AppBindings>();
  nodeApp.use('*', async (c, next) => {
    await next();
    if (isApiPath(c.req.path)) return;
    c.header('Content-Security-Policy', FRONTEND_CSP);
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
  });
  nodeApp.route('/', app);
  nodeApp.use('*', serveStatic({ root: distRoot }));
  nodeApp.get('*', serveStatic({ path: path.join(distRoot, 'index.html') }));
  return nodeApp;
};
