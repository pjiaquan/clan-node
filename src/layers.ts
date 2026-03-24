import type { Context, Hono } from 'hono';
import type { AppBindings, Env } from './types';
import { protectPersonWriteFields } from './data_protection';
import { recordAuditLog } from './audit';
import { queueRemoteJson } from './dual_write';

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

const hasColumn = async (db: D1Database, table: string, column: string) => {
  const pragma = await db.prepare(`PRAGMA table_info('${table}')`).all();
  const names = new Set((pragma.results as Array<Record<string, unknown>>).map((row) => String((row as any).name)));
  return names.has(column);
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

const insertSeedGraph = async (env: Env, layerId: string, layerName: string, now: string) => {
  const [root, left, right] = createSeedNodes(layerName);
  for (const person of [root, left, right]) {
    const protectedFields = await protectPersonWriteFields(env, {
      metadata: JSON.stringify(person.metadata),
    });
    await env.DB.prepare(
      `INSERT INTO people (
        id, layer_id, name, english_name, email, gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      person.id,
      layerId,
      person.name,
      null,
      null,
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
    ).run();
  }

  await env.DB.prepare(
    `INSERT INTO relationships (
      layer_id, from_person_id, to_person_id, type, metadata, created_at
    ) VALUES (?, ?, ?, 'parent_child', ?, ?)`
  ).bind(layerId, root.id, left.id, EXAMPLE_RELATIONSHIP_METADATA, now).run();

  await env.DB.prepare(
    `INSERT INTO relationships (
      layer_id, from_person_id, to_person_id, type, metadata, created_at
    ) VALUES (?, ?, ?, 'parent_child', ?, ?)`
  ).bind(layerId, root.id, right.id, EXAMPLE_RELATIONSHIP_METADATA, now).run();

  return {
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

    await c.env.DB.prepare('BEGIN IMMEDIATE').run();
    let seedSummary: { center_id: string; node_count: number; relationship_count: number } | null = null;
    try {
      await c.env.DB.prepare(
        `INSERT INTO graph_layers (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(providedId, name, description, now, now).run();
      seedSummary = await insertSeedGraph(c.env, providedId, name, now);
      await c.env.DB.prepare('COMMIT').run();
    } catch (error) {
      await c.env.DB.prepare('ROLLBACK').run().catch(() => undefined);
      throw error;
    }

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
}
