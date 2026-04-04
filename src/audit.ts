import type { Context, Hono } from 'hono';
import type { AppBindings, UserRole } from './types';
import { safeParse } from './utils';

type AuditLogInput = {
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  summary?: string | null;
  details?: Record<string, unknown> | null;
};

type RateLimitAuditInput = {
  limiterKey: string;
  action: string;
  route: string;
  retryAfterSeconds?: number;
  summary: string;
};

const normalizeRole = (value: unknown): UserRole | null => {
  if (value === 'admin' || value === 'readonly') return value;
  return null;
};

let tableStatus: 'unknown' | 'present' | 'missing' = 'unknown';

const hasAuditTable = async (db: D1Database) => {
  if (tableStatus === 'present') return true;
  if (tableStatus === 'missing') return false;
  const row = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_logs'"
  ).first();
  tableStatus = row ? 'present' : 'missing';
  return tableStatus === 'present';
};

export const recordAuditLog = async (c: Context<AppBindings>, input: AuditLogInput) => {
  const action = input.action?.trim();
  const resourceType = input.resourceType?.trim();
  if (!action || !resourceType) return;
  if (!(await hasAuditTable(c.env.DB))) return;

  const sessionUser = c.get('sessionUser');
  const now = new Date().toISOString();
  const detailsJson = input.details ? JSON.stringify(input.details) : null;
  const summary = input.summary?.trim().slice(0, 500) || null;
  const resourceId = input.resourceId === undefined || input.resourceId === null
    ? null
    : String(input.resourceId);

  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (
        actor_user_id, actor_username, actor_role,
        action, resource_type, resource_id, summary, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sessionUser?.userId ?? null,
      sessionUser?.username ?? null,
      sessionUser?.role ?? null,
      action,
      resourceType,
      resourceId,
      summary,
      detailsJson,
      now
    ).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such table')) {
      tableStatus = 'missing';
      return;
    }
    console.warn('Failed to write audit log:', error);
  }
};

export const recordRateLimitAudit = async (c: Context<AppBindings>, input: RateLimitAuditInput) => {
  await recordAuditLog(c, {
    action: 'rate_limit_block',
    resourceType: 'security',
    resourceId: input.action,
    summary: input.summary,
    details: {
      limiter_key: input.limiterKey,
      action: input.action,
      route: input.route,
      retry_after_seconds: input.retryAfterSeconds ?? null
    }
  });
};

export function registerAuditRoutes(app: Hono<AppBindings>) {
  app.get('/api/audit-logs', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (!(await hasAuditTable(c.env.DB))) {
      return c.json([]);
    }

    const rawLimit = Number(c.req.query('limit') || 200);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(Math.trunc(rawLimit), 500))
      : 200;

    const { results } = await c.env.DB.prepare(
      `SELECT
        id, actor_user_id, actor_username, actor_role,
        action, resource_type, resource_id, summary, details, created_at
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(limit).all();

    return c.json(results.map((row: any) => ({
      id: Number(row.id),
      actor_user_id: (row.actor_user_id as string | null) ?? null,
      actor_username: (row.actor_username as string | null) ?? null,
      actor_role: normalizeRole(row.actor_role),
      action: row.action as string,
      resource_type: row.resource_type as string,
      resource_id: (row.resource_id as string | null) ?? null,
      summary: (row.summary as string | null) ?? null,
      details: safeParse((row.details as string | null) ?? null),
      created_at: row.created_at as string
    })));
  });
}
