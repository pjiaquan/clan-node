import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppBindings } from './types';
import { registerAuthRoutes, requireAuth, requireCsrf, requireWriteAccess } from './auth';
import { registerPeopleRoutes } from './people';
import { registerRelationshipRoutes } from './relationships';
import { registerGraphRoutes } from './graph';
import { registerNotificationRoutes } from './notifications';
import { registerAuditRoutes } from './audit';
import { registerRelationshipTypeLabelRoutes } from './relationship_type_labels';
import { registerKinshipLabelRoutes } from './kinship_labels';
import { registerBackupRoutes } from './backup';
import { registerLayerRoutes } from './layers';
import { verifyDualWriteRequest } from './dual_write';
import { KNOWN_ENVIRONMENTS, isKnownEnvironment, isProductionEnv } from './environment';
import { ValidationError } from './validation';

export const app = new Hono<AppBindings>();

/**
 * Last-resort error handler.
 *
 * There was none, so anything that threw -- a D1 bind error from a value of
 * the wrong type, a CHECK constraint violation, a malformed JSON body --
 * surfaced as a 500 carrying the underlying message to the client.
 * `ValidationError` is a client mistake and answers 400; everything else is
 * logged and answered generically.
 */
app.onError((error, c) => {
  if (error instanceof ValidationError) {
    return c.json({ error: error.message }, 400);
  }
  if (error instanceof SyntaxError) {
    return c.json({ error: 'Body must be valid JSON' }, 400);
  }
  console.error('Unhandled error:', c.req.method, c.req.path, error);
  return c.json({ error: 'Internal server error' }, 500);
});

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // frontend/public/_headers only covers Cloudflare Pages assets, so the API
  // needs its own. This Worker serves JSON and images, never documents, so
  // nothing legitimate may be loaded from one of its responses.
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if (isProductionEnv(c.env)) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
});

// Fail closed on a misconfigured environment. Cookie flags, HSTS and the
// encryption-key requirement all key off ENVIRONMENT, so an unset or
// misspelled value must not quietly select the weaker development behaviour.
app.use('*', async (c, next) => {
  if (!isKnownEnvironment(c.env)) {
    return c.json({
      error: `Server misconfiguration: ENVIRONMENT must be one of ${KNOWN_ENVIRONMENTS.join(', ')}`
    }, 503);
  }
  return next();
});

// Enable CORS for frontend
app.use('*', cors({
  origin: (origin, c) => {
    const normalize = (value: string) => value.replace(/\/+$/, '').toLowerCase();
    const allowedOrigins = (c.env.FRONTEND_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((entry: string) => normalize(entry.trim()))
      .filter(Boolean);
    if (!origin) return allowedOrigins[0] || '';
    const normalizedOrigin = normalize(origin);
    return allowedOrigins.includes(normalizedOrigin) ? origin : '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Health check
app.get('/healthz', (c) => {
  return c.json({ status: 'ok', message: 'Clan Node API' });
});

app.use('/api/*', requireAuth);
app.use('/api/*', async (c, next) => {
  const result = await verifyDualWriteRequest(c.env, c.req.raw);
  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }
  return next();
});
app.use('/api/*', requireCsrf);
app.use('/api/*', requireWriteAccess);
registerAuthRoutes(app);
registerPeopleRoutes(app);
registerRelationshipRoutes(app);
registerGraphRoutes(app);
registerNotificationRoutes(app);
registerAuditRoutes(app);
registerRelationshipTypeLabelRoutes(app);
registerKinshipLabelRoutes(app);
registerBackupRoutes(app);
registerLayerRoutes(app);

export default app;
