import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { registerAuthRoutes, requireAuth } from './auth';
import { registerPeopleRoutes } from './people';
import { registerRelationshipRoutes } from './relationships';
import { registerGraphRoutes } from './graph';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for frontend
app.use('*', cors({
  origin: (origin, c) => {
    const allowedOrigins = (c.env.FRONTEND_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean);
    if (!origin) return allowedOrigins[0] || '';
    return allowedOrigins.includes(origin) ? origin : '';
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
registerAuthRoutes(app);
registerPeopleRoutes(app);
registerRelationshipRoutes(app);
registerGraphRoutes(app);

export default app;
