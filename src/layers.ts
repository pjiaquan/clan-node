import type { Context, Hono } from 'hono';
import type { AppBindings, Env } from './types';
import { checkAndConsumeRateLimit, getRequestIpAddress } from './auth';
import { protectPersonWriteFields } from './data_protection';
import { recordAuditLog, recordRateLimitAudit } from './audit';
import { queueRemoteJson } from './dual_write';
import { LAYER_WRITE_RATE_LIMIT } from './rate_limits';

export const DEFAULT_LAYER_ID = 'default';
export const DEFAULT_LAYER_NAME = 'Default Layer';

export type GraphLayerRecord = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  node_count: number;
  relationship_count: number;
};

type SeedNode = {
  id: string;
  name: string;
  gender: 'M' | 'F' | 'O';
  metadata: {
    position: { x: number; y: number };
  };
};

const EXAMPLE_RELATIONSHIP_METADATA = JSON.stringify({
  sourceHandle: 'bottom-s',
  targetHandle: 'top-t',
});

let layerSchemaSupportPromise: Promise<void> | null = null;
let peopleSchemaSupportPromise: Promise<{ hasEmail: boolean }> | null = null;

const isAdmin = (c: Context<AppBindings>) => {
  const sessionUser = c.get('sessionUser');
  return Boolean(sessionUser && sessionUser.role === 'admin');
};

const deriveStorageKeyFromUrl = (avatarUrl: string | null | undefined) => {
  if (!avatarUrl) return null;
  if (!avatarUrl.startsWith('/api/avatars/')) return null;
  return avatarUrl.replace('/api/avatars/', '');
};

const hasColumn = async (db: D1Database, table: string, column: string) => {
  const pragma = await db.prepare(`PRAGMA table_info('${table}')`).all();
  const names = new Set((pragma.results as Array<Record<string, unknown>>).map((row) => String((row as any).name)));
  return names.has(column);
};

const getPeopleSchemaSupport = async (db: D1Database) => {
  if (!peopleSchemaSupportPromise) {
    peopleSchemaSupportPromise = (async () => {
      const pragma = await db.prepare("PRAGMA table_info('people')").all();
      const names = new Set((pragma.results as Array<Record<string, unknown>>).map((row) => String((row as any).name)));
      if (!names.has('email')) {
        await db.prepare('ALTER TABLE people ADD COLUMN email TEXT').run();
        names.add('email');
      }
      return { hasEmail: names.has('email') };
    })().catch((error) => {
      peopleSchemaSupportPromise = null;
      throw error;
    });
  }
  return peopleSchemaSupportPromise;
};

const createSeedNodes = (layerName: string): SeedNode[] => ([
  {
    id: crypto.randomUUID(),
    name: `${layerName} Root`,
    gender: 'O',
    metadata: { position: { x: 0, y: 0 } },
  },
  {
    id: crypto.randomUUID(),
    name: `${layerName} Node A`,
    gender: 'O',
    metadata: { position: { x: -220, y: 160 } },
  },
  {
    id: crypto.randomUUID(),
    name: `${layerName} Node B`,
    gender: 'O',
    metadata: { position: { x: 220, y: 160 } },
  },
]);

export const ensureLayerSchemaSupport = async (db: D1Database) => {
  if (!layerSchemaSupportPromise) {
    layerSchemaSupportPromise = (async () => {
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS graph_layers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )`
      ).run();

      if (!await hasColumn(db, 'people', 'layer_id')) {
        await db.prepare(`ALTER TABLE people ADD COLUMN layer_id TEXT`).run();
      }
      if (!await hasColumn(db, 'relationships', 'layer_id')) {
        await db.prepare(`ALTER TABLE relationships ADD COLUMN layer_id TEXT`).run();
      }

      await db.prepare('CREATE INDEX IF NOT EXISTS idx_people_layer_id ON people(layer_id, created_at)').run();
      await db.prepare('CREATE INDEX IF NOT EXISTS idx_relationships_layer_id ON relationships(layer_id, created_at)').run();

      const now = new Date().toISOString();
      await db.prepare(
        `INSERT OR IGNORE INTO graph_layers (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(DEFAULT_LAYER_ID, DEFAULT_LAYER_NAME, 'Migrated default graph layer', now, now).run();

      await db.prepare('UPDATE people SET layer_id = ? WHERE layer_id IS NULL OR TRIM(layer_id) = \'\'').bind(DEFAULT_LAYER_ID).run();
      await db.prepare('UPDATE relationships SET layer_id = ? WHERE layer_id IS NULL OR TRIM(layer_id) = \'\'').bind(DEFAULT_LAYER_ID).run();
    })().catch((error) => {
      layerSchemaSupportPromise = null;
      throw error;
    });
  }
  return layerSchemaSupportPromise;
};

export const resolveLayerId = (c: Context<AppBindings>, body?: Record<string, unknown> | null) => {
  const queryValue = c.req.query('layer');
  if (typeof queryValue === 'string' && queryValue.trim()) {
    return queryValue.trim();
  }
  const bodyValue = body?.layer_id;
  if (typeof bodyValue === 'string' && bodyValue.trim()) {
    return bodyValue.trim();
  }
  return DEFAULT_LAYER_ID;
};

export const listGraphLayers = async (db: D1Database): Promise<GraphLayerRecord[]> => {
  await ensureLayerSchemaSupport(db);
  const { results } = await db.prepare(
    `SELECT
      l.id,
      l.name,
      l.description,
      l.created_at,
      l.updated_at,
      COALESCE((
        SELECT COUNT(*)
        FROM people p
        WHERE p.layer_id = l.id
      ), 0) AS node_count,
      COALESCE((
        SELECT COUNT(*)
        FROM relationships r
        WHERE r.layer_id = l.id
      ), 0) AS relationship_count
     FROM graph_layers l
     ORDER BY l.created_at ASC, l.id ASC`
  ).all();

  return results.map((row: any) => ({
    id: String(row.id),
    name: String(row.name),
    description: row.description === null ? null : String(row.description),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    node_count: Number(row.node_count ?? 0),
    relationship_count: Number(row.relationship_count ?? 0),
  }));
};

export const assertLayerExists = async (db: D1Database, layerId: string) => {
  await ensureLayerSchemaSupport(db);
  const row = await db.prepare(
    'SELECT id FROM graph_layers WHERE id = ?'
  ).bind(layerId).first();
  return Boolean(row);
};

const buildSeedGraphStatements = async (env: Env, layerId: string, layerName: string, now: string) => {
  const peopleSchema = await getPeopleSchemaSupport(env.DB);
  const [root, left, right] = createSeedNodes(layerName);
  const statements: D1PreparedStatement[] = [];
  for (const person of [root, left, right]) {
    const protectedFields = await protectPersonWriteFields(env, {
      metadata: JSON.stringify(person.metadata),
    });
    const insertColumns = [
      'id', 'layer_id', 'name', 'english_name',
      ...(peopleSchema.hasEmail ? ['email'] : []),
      'gender', 'blood_type', 'dob', 'dod', 'tob', 'tod', 'avatar_url', 'metadata', 'created_at', 'updated_at'
    ];
    const insertValues: Array<string | null> = [
      person.id,
      layerId,
      person.name,
      null,
      ...(peopleSchema.hasEmail ? [null] : []),
      person.gender,
      null,
      null,
      null,
      null,
      null,
      null,
      protectedFields.metadata ?? null,
      now,
      now
    ];
    statements.push(env.DB.prepare(
      `INSERT INTO people (${insertColumns.join(', ')})
       VALUES (${insertColumns.map(() => '?').join(', ')})`
    ).bind(...insertValues));
  }

  statements.push(env.DB.prepare(
    `INSERT INTO relationships (
      layer_id, from_person_id, to_person_id, type, metadata, created_at
    ) VALUES (?, ?, ?, 'parent_child', ?, ?)`
  ).bind(layerId, root.id, left.id, EXAMPLE_RELATIONSHIP_METADATA, now));

  statements.push(env.DB.prepare(
    `INSERT INTO relationships (
      layer_id, from_person_id, to_person_id, type, metadata, created_at
    ) VALUES (?, ?, ?, 'parent_child', ?, ?)`
  ).bind(layerId, root.id, right.id, EXAMPLE_RELATIONSHIP_METADATA, now));

  return {
    statements,
    center_id: root.id,
    node_count: 3,
    relationship_count: 2,
  };
};

export function registerLayerRoutes(app: Hono<AppBindings>) {
  app.get('/api/layers', async (c) => {
    const layers = await listGraphLayers(c.env.DB);
    return c.json({ layers });
  });

  app.post('/api/layers', async (c) => {
    if (!isAdmin(c)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const rateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'layer_write',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...LAYER_WRITE_RATE_LIMIT
    });
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'layer_write',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: '/api/layers',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        summary: `圖層寫入速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many layer write requests' }, 429);
    }

    const body = await c.req.json();
    const providedId = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID();
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : 'New Layer';
    const description = typeof body?.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null;
    const now = new Date().toISOString();

    await ensureLayerSchemaSupport(c.env.DB);
    const existing = await c.env.DB.prepare(
      'SELECT id FROM graph_layers WHERE id = ?'
    ).bind(providedId).first();
    if (existing) {
      return c.json({ error: 'Layer already exists' }, 409);
    }

    const seedSummary = await buildSeedGraphStatements(c.env, providedId, name, now);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO graph_layers (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(providedId, name, description, now, now),
      ...seedSummary.statements,
    ]);

    await recordAuditLog(c, {
      action: 'create',
      resourceType: 'layers',
      resourceId: providedId,
      summary: `建立圖層 ${name}`,
      details: {
        name,
        description,
        center_id: seedSummary?.center_id ?? null,
        node_count: seedSummary?.node_count ?? 0,
        relationship_count: seedSummary?.relationship_count ?? 0,
      }
    });

    queueRemoteJson(c, 'POST', '/api/layers', {
      id: providedId,
      name,
      description,
    });

    const layers = await listGraphLayers(c.env.DB);
    const createdLayer = layers.find((item) => item.id === providedId);
    return c.json({
      layer: createdLayer,
      center_id: seedSummary?.center_id ?? null,
    }, 201);
  });

  app.delete('/api/layers/:id', async (c) => {
    if (!isAdmin(c)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const layerId = c.req.param('id');
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const rateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'layer_write',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...LAYER_WRITE_RATE_LIMIT
    });
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'layer_write',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: `/api/layers/${layerId}`,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        summary: `圖層刪除速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many layer write requests' }, 429);
    }
    await ensureLayerSchemaSupport(c.env.DB);

    const existing = await c.env.DB.prepare(
      `SELECT id, name, description
       FROM graph_layers
       WHERE id = ?`
    ).bind(layerId).first();
    if (!existing) {
      return c.json({ error: 'Layer not found' }, 404);
    }

    const allLayers = await listGraphLayers(c.env.DB);
    if (allLayers.length <= 1) {
      return c.json({ error: 'Cannot delete the last layer' }, 409);
    }

    const avatarRows = await c.env.DB.prepare(
      `SELECT pa.avatar_url, pa.storage_key
       FROM person_avatars pa
       INNER JOIN people p ON p.id = pa.person_id
       WHERE p.layer_id = ?`
    ).bind(layerId).all();

    for (const row of avatarRows.results as Array<Record<string, unknown>>) {
      const key = String(row.storage_key ?? '') || deriveStorageKeyFromUrl(String(row.avatar_url ?? ''));
      if (!key) continue;
      await c.env.AVATARS.delete(key);
    }

    const peopleCountRow = await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM people WHERE layer_id = ?'
    ).bind(layerId).first();
    const relationshipCountRow = await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM relationships WHERE layer_id = ?'
    ).bind(layerId).first();

    await c.env.DB.batch([
      c.env.DB.prepare(
        `DELETE FROM person_avatars
         WHERE person_id IN (
           SELECT id FROM people WHERE layer_id = ?
         )`
      ).bind(layerId),
      c.env.DB.prepare(
        `DELETE FROM person_custom_fields
         WHERE person_id IN (
           SELECT id FROM people WHERE layer_id = ?
         )`
      ).bind(layerId),
      c.env.DB.prepare('DELETE FROM relationships WHERE layer_id = ?').bind(layerId),
      c.env.DB.prepare('DELETE FROM people WHERE layer_id = ?').bind(layerId),
      c.env.DB.prepare('DELETE FROM graph_layers WHERE id = ?').bind(layerId),
    ]);

    await recordAuditLog(c, {
      action: 'delete',
      resourceType: 'layers',
      resourceId: layerId,
      summary: `刪除圖層 ${String((existing as any).name ?? layerId)}`,
      details: {
        name: String((existing as any).name ?? layerId),
        description: ((existing as any).description as string | null) ?? null,
        removed_node_count: Number((peopleCountRow as any)?.count ?? 0),
        removed_relationship_count: Number((relationshipCountRow as any)?.count ?? 0),
        removed_avatar_count: avatarRows.results.length,
      }
    });

    queueRemoteJson(c, 'DELETE', `/api/layers/${layerId}`, undefined);

    return c.json({ success: true, id: layerId });
  });
}
