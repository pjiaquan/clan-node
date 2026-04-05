import type { Hono } from 'hono';
import type { AppBindings, RelationshipType } from './types';
import { checkAndConsumeRateLimit, getRequestIpAddress } from './auth';
import { notifyUpdate } from './notify';
import { recordAuditLog, recordRateLimitAudit } from './audit';
import { readJsonObjectBody } from './http';
import { RELATIONSHIP_LABEL_WRITE_RATE_LIMIT } from './rate_limits';

type RelationshipTypeLabelRow = {
  type: RelationshipType;
  label: string;
  description: string;
  default_label: string;
  default_description: string;
  created_at: string | null;
  updated_at: string | null;
};

type RelationshipTypeDefault = {
  type: RelationshipType;
  label: string;
  description: string;
};

const RELATIONSHIP_TYPE_DEFAULTS: readonly RelationshipTypeDefault[] = [
  { type: 'parent_child', label: '親子', description: '父母與子女關係' },
  { type: 'spouse', label: '夫妻', description: '現任配偶關係' },
  { type: 'ex_spouse', label: '前配偶', description: '曾為配偶關係' },
  { type: 'sibling', label: '手足', description: '兄弟姐妹關係' },
  { type: 'in_law', label: '姻親', description: '婚姻延伸關係' },
] as const;

const RELATIONSHIP_TYPE_ORDER: RelationshipType[] = [
  'parent_child',
  'spouse',
  'ex_spouse',
  'sibling',
  'in_law',
];

const DEFAULT_BY_TYPE = new Map<RelationshipType, RelationshipTypeDefault>(
  RELATIONSHIP_TYPE_DEFAULTS.map((item) => [item.type, item])
);

const isRelationshipType = (value: unknown): value is RelationshipType => (
  value === 'parent_child'
  || value === 'spouse'
  || value === 'ex_spouse'
  || value === 'sibling'
  || value === 'in_law'
);

const normalizeText = (value: unknown) => (
  typeof value === 'string' ? value.trim() : ''
);

async function ensureRelationshipTypeLabelTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS relationship_type_labels (
      type TEXT PRIMARY KEY CHECK(type IN ('parent_child', 'spouse', 'ex_spouse', 'sibling', 'in_law')),
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  for (const item of RELATIONSHIP_TYPE_DEFAULTS) {
    await db.prepare(
      'INSERT OR IGNORE INTO relationship_type_labels (type, label, description, created_at, updated_at) VALUES (?, ?, ?, datetime(\'now\'), datetime(\'now\'))'
    ).bind(item.type, item.label, item.description).run();
  }
}

const mapRow = (row: any): RelationshipTypeLabelRow | null => {
  const rawType = row?.type;
  if (!isRelationshipType(rawType)) return null;
  const defaultItem = DEFAULT_BY_TYPE.get(rawType);
  if (!defaultItem) return null;
  const label = normalizeText(row?.label) || defaultItem.label;
  const description = normalizeText(row?.description) || defaultItem.description;
  return {
    type: rawType,
    label,
    description,
    default_label: defaultItem.label,
    default_description: defaultItem.description,
    created_at: typeof row?.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row?.updated_at === 'string' ? row.updated_at : null,
  };
};

async function listRelationshipTypeLabels(db: D1Database): Promise<RelationshipTypeLabelRow[]> {
  await ensureRelationshipTypeLabelTable(db);
  const { results } = await db.prepare(
    'SELECT type, label, description, created_at, updated_at FROM relationship_type_labels'
  ).all();

  const byType = new Map<RelationshipType, RelationshipTypeLabelRow>();
  for (const row of results) {
    const mapped = mapRow(row);
    if (mapped) {
      byType.set(mapped.type, mapped);
    }
  }

  return RELATIONSHIP_TYPE_ORDER.map((type) => {
    const existing = byType.get(type);
    if (existing) return existing;
    const fallback = DEFAULT_BY_TYPE.get(type)!;
    return {
      type,
      label: fallback.label,
      description: fallback.description,
      default_label: fallback.label,
      default_description: fallback.description,
      created_at: null,
      updated_at: null,
    };
  });
}

export function registerRelationshipTypeLabelRoutes(app: Hono<AppBindings>) {
  app.get('/api/relationship-type-labels', async (c) => {
    const items = await listRelationshipTypeLabels(c.env.DB);
    return c.json(items);
  });

  app.put('/api/relationship-type-labels/:type', async (c) => {
    const type = c.req.param('type');
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const rateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'relationship_label_write',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...RELATIONSHIP_LABEL_WRITE_RATE_LIMIT
    });
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'relationship_label_write',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: `/api/relationship-type-labels/${type}`,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        summary: `關係名稱寫入速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many relationship label write requests' }, 429);
    }
    if (!isRelationshipType(type)) {
      return c.json({ error: 'invalid relationship type' }, 400);
    }

    const body = await readJsonObjectBody(c.req);
    if (!body) {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const hasLabel = Object.prototype.hasOwnProperty.call(body, 'label');
    const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
    if (!hasLabel && !hasDescription) {
      return c.json({ error: 'label or description is required' }, 400);
    }

    await ensureRelationshipTypeLabelTable(c.env.DB);
    const existing = await c.env.DB.prepare(
      'SELECT type, label, description, created_at, updated_at FROM relationship_type_labels WHERE type = ?'
    ).bind(type).first();
    const defaultItem = DEFAULT_BY_TYPE.get(type)!;

    const currentLabel = normalizeText((existing as any)?.label) || defaultItem.label;
    const currentDescription = normalizeText((existing as any)?.description) || defaultItem.description;

    const nextLabel = hasLabel ? normalizeText((body as any).label) : currentLabel;
    const nextDescription = hasDescription ? normalizeText((body as any).description) : currentDescription;

    if (!nextLabel) {
      return c.json({ error: 'label cannot be empty' }, 400);
    }
    if (nextLabel.length > 24) {
      return c.json({ error: 'label is too long (max 24 chars)' }, 400);
    }
    if (nextDescription.length > 80) {
      return c.json({ error: 'description is too long (max 80 chars)' }, 400);
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(`
      INSERT INTO relationship_type_labels (type, label, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(type) DO UPDATE SET
        label = excluded.label,
        description = excluded.description,
        updated_at = excluded.updated_at
    `).bind(type, nextLabel, nextDescription, now, now).run();

    const updated = await c.env.DB.prepare(
      'SELECT type, label, description, created_at, updated_at FROM relationship_type_labels WHERE type = ?'
    ).bind(type).first();
    const mapped = mapRow(updated);
    if (!mapped) {
      return c.json({ error: 'Failed to load updated label' }, 500);
    }

    notifyUpdate(c, 'relationship_type_labels:update', {
      type: mapped.type,
      label: mapped.label,
      description: mapped.description,
    });
    await recordAuditLog(c, {
      action: 'update',
      resourceType: 'relationship_type_labels',
      resourceId: mapped.type,
      summary: `更新關係名稱 ${mapped.type}`,
      details: {
        type: mapped.type,
        label: mapped.label,
        description: mapped.description,
      }
    });

    return c.json(mapped);
  });

  app.post('/api/relationship-type-labels/reset', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const rateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'relationship_label_write',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...RELATIONSHIP_LABEL_WRITE_RATE_LIMIT
    });
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'relationship_label_write',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: '/api/relationship-type-labels/reset',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        summary: `關係名稱重設速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many relationship label write requests' }, 429);
    }
    await ensureRelationshipTypeLabelTable(c.env.DB);
    const now = new Date().toISOString();

    for (const item of RELATIONSHIP_TYPE_DEFAULTS) {
      await c.env.DB.prepare(`
        INSERT INTO relationship_type_labels (type, label, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(type) DO UPDATE SET
          label = excluded.label,
          description = excluded.description,
          updated_at = excluded.updated_at
      `).bind(item.type, item.label, item.description, now, now).run();
    }

    const items = await listRelationshipTypeLabels(c.env.DB);
    notifyUpdate(c, 'relationship_type_labels:reset', {
      count: items.length
    });
    await recordAuditLog(c, {
      action: 'reset',
      resourceType: 'relationship_type_labels',
      resourceId: null,
      summary: '重設親戚關係名稱為預設值',
      details: {
        count: items.length
      }
    });

    return c.json({ items });
  });
}
