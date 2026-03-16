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

const app = new Hono<AppBindings>();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (c.env.ENVIRONMENT === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
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
app.get('/', (c) => {
  return c.json({ status: 'ok', message: 'Clan Node API' });
});

app.use('/api/*', requireAuth);
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

export default app;
