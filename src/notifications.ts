import type { Context, Hono } from 'hono';
import type { AppBindings } from './types';
import { notifyUpdate } from './notify';

type NotificationType = 'rename' | 'avatar' | 'relationship' | 'other';
type NotificationStatus = 'pending' | 'in_progress' | 'resolved' | 'rejected';

type NotificationRow = {
  id: string;
  type: NotificationType;
  target_person_id: string | null;
  target_person_name: string | null;
  message: string;
  status: NotificationStatus;
  created_by_user_id: string;
  created_by_username: string;
  resolved_by_user_id: string | null;
  resolved_by_username: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const isAdmin = (c: Context<AppBindings>) => {
  const sessionUser = c.get('sessionUser');
  return Boolean(sessionUser && sessionUser.role === 'admin');
};

const normalizeType = (value: unknown): NotificationType => {
  if (value === 'rename' || value === 'avatar' || value === 'relationship') {
    return value;
  }
  return 'other';
};

const parseStatus = (value: unknown): NotificationStatus | null => {
  if (value === 'pending' || value === 'in_progress' || value === 'resolved' || value === 'rejected') {
    return value;
  }
  return null;
};

const mapRow = (row: any): NotificationRow => ({
  id: row.id as string,
  type: normalizeType(row.type),
  target_person_id: (row.target_person_id as string | null) ?? null,
  target_person_name: (row.target_person_name as string | null) ?? null,
  message: row.message as string,
  status: parseStatus(row.status) ?? 'pending',
  created_by_user_id: row.created_by_user_id as string,
  created_by_username: row.created_by_username as string,
  resolved_by_user_id: (row.resolved_by_user_id as string | null) ?? null,
  resolved_by_username: (row.resolved_by_username as string | null) ?? null,
  resolved_at: (row.resolved_at as string | null) ?? null,
  created_at: row.created_at as string,
  updated_at: row.updated_at as string,
});

export function registerNotificationRoutes(app: Hono<AppBindings>) {
  app.post('/api/notifications', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const message = typeof (body as any).message === 'string' ? (body as any).message.trim() : '';
    if (!message) {
      return c.json({ error: 'message is required' }, 400);
    }
    if (message.length > 2000) {
      return c.json({ error: 'message is too long' }, 400);
    }

    const type = normalizeType((body as any).type);
    const targetPersonId = typeof (body as any).target_person_id === 'string' && (body as any).target_person_id
      ? (body as any).target_person_id
      : null;

    let targetPersonName = typeof (body as any).target_person_name === 'string'
      ? (body as any).target_person_name.trim()
      : '';

    if (targetPersonId && !targetPersonName) {
      const person = await c.env.DB.prepare('SELECT name FROM people WHERE id = ?').bind(targetPersonId).first();
      targetPersonName = ((person as any)?.name as string | undefined)?.trim() || '';
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    await c.env.DB.prepare(
      `INSERT INTO notifications (
        id, type, target_person_id, target_person_name, message, status,
        created_by_user_id, created_by_username,
        resolved_by_user_id, resolved_by_username, resolved_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, ?, ?)`
    ).bind(
      id,
      type,
      targetPersonId,
      targetPersonName || null,
      message,
      sessionUser.userId,
      sessionUser.username,
      now,
      now
    ).run();

    const created = await c.env.DB.prepare(
      'SELECT * FROM notifications WHERE id = ?'
    ).bind(id).first();
    if (!created) {
      return c.json({ error: 'Failed to create notification' }, 500);
    }

    notifyUpdate(c, 'notifications:create', {
      id,
      type,
      target_person_id: targetPersonId,
      target_person_name: targetPersonName || null,
      created_by_user_id: sessionUser.userId,
      created_by_username: sessionUser.username
    });

    return c.json(mapRow(created), 201);
  });

  app.get('/api/notifications', async (c) => {
    if (!isAdmin(c)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const statusQuery = c.req.query('status');
    const status = statusQuery ? parseStatus(statusQuery) : null;
    if (statusQuery && !status) {
      return c.json({ error: 'invalid status' }, 400);
    }

    const { results } = status
      ? await c.env.DB.prepare(
        'SELECT * FROM notifications WHERE status = ? ORDER BY created_at DESC'
      ).bind(status).all()
      : await c.env.DB.prepare(
        'SELECT * FROM notifications ORDER BY created_at DESC'
      ).all();

    return c.json(results.map(mapRow));
  });

  app.get('/api/notifications/stats', async (c) => {
    if (!isAdmin(c)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const { results } = await c.env.DB.prepare(
      'SELECT status, COUNT(*) as count FROM notifications GROUP BY status'
    ).all();

    const counts: Record<NotificationStatus, number> = {
      pending: 0,
      in_progress: 0,
      resolved: 0,
      rejected: 0
    };

    for (const row of results) {
      const status = parseStatus((row as any).status);
      if (!status) continue;
      counts[status] = Number((row as any).count ?? 0);
    }

    return c.json({
      total: counts.pending + counts.in_progress + counts.resolved + counts.rejected,
      pending: counts.pending,
      in_progress: counts.in_progress,
      resolved: counts.resolved,
      rejected: counts.rejected,
      unresolved: counts.pending + counts.in_progress
    });
  });

  app.put('/api/notifications/:id', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT id FROM notifications WHERE id = ?').bind(id).first();
    if (!existing) {
      return c.json({ error: 'Notification not found' }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const nextStatus = parseStatus((body as any).status);
    if (!nextStatus) {
      return c.json({ error: 'status is required' }, 400);
    }

    const now = new Date().toISOString();
    if (nextStatus === 'resolved' || nextStatus === 'rejected') {
      await c.env.DB.prepare(
        `UPDATE notifications
         SET status = ?, resolved_by_user_id = ?, resolved_by_username = ?, resolved_at = ?, updated_at = ?
         WHERE id = ?`
      ).bind(nextStatus, sessionUser.userId, sessionUser.username, now, now, id).run();
    } else {
      await c.env.DB.prepare(
        `UPDATE notifications
         SET status = ?, resolved_by_user_id = NULL, resolved_by_username = NULL, resolved_at = NULL, updated_at = ?
         WHERE id = ?`
      ).bind(nextStatus, now, id).run();
    }

    const updated = await c.env.DB.prepare('SELECT * FROM notifications WHERE id = ?').bind(id).first();
    if (!updated) {
      return c.json({ error: 'Notification not found' }, 404);
    }
    notifyUpdate(c, 'notifications:update', {
      id,
      status: nextStatus,
      handled_by: sessionUser.username
    });
    return c.json(mapRow(updated));
  });

  app.delete('/api/notifications/:id', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM notifications WHERE id = ?').bind(id).first();
    if (!existing) {
      return c.json({ error: 'Notification not found' }, 404);
    }

    await c.env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(id).run();

    notifyUpdate(c, 'notifications:delete', {
      id,
      type: (existing as any).type,
      target_person_id: (existing as any).target_person_id,
      target_person_name: (existing as any).target_person_name,
      deleted_by: sessionUser.username
    });

    return c.json({ ok: true });
  });
}
