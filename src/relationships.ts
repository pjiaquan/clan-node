import type { Hono } from 'hono';
import type { AppBindings, Env } from './types';
import { safeParse } from './utils';

async function getSiblingLinkMeta(db: D1Database, aId: string, bId: string) {
  const { results } = await db.prepare(
    'SELECT id, dob FROM people WHERE id IN (?, ?)'
  ).bind(aId, bId).all();

  const a = results.find(p => p.id === aId) as any | undefined;
  const b = results.find(p => p.id === bId) as any | undefined;
  const aDob = a?.dob ? new Date(a.dob).getTime() : 0;
  const bDob = b?.dob ? new Date(b.dob).getTime() : 0;

  if (aDob && bDob && aDob !== bDob) {
    const olderId = aDob < bDob ? aId : bId;
    const youngerId = olderId === aId ? bId : aId;
    return {
      fromId: olderId,
      toId: youngerId,
      metadata: JSON.stringify({ sourceHandle: 'right-s', targetHandle: 'left-t' })
    };
  }

  return {
    fromId: aId,
    toId: bId,
    metadata: JSON.stringify({ sourceHandle: 'left-s', targetHandle: 'right-t' })
  };
}

async function getSiblingIds(db: D1Database, personId: string) {
  const ids = new Set<string>();

  const { results: siblingEdges } = await db.prepare(
    "SELECT from_person_id, to_person_id FROM relationships WHERE type = 'sibling' AND (from_person_id = ? OR to_person_id = ?)"
  ).bind(personId, personId).all();
  for (const rel of siblingEdges) {
    const relAny = rel as any;
    const otherId = relAny.from_person_id === personId ? relAny.to_person_id : relAny.from_person_id;
    if (otherId && otherId !== personId) {
      ids.add(otherId as string);
    }
  }

  const { results: parentEdges } = await db.prepare(
    "SELECT from_person_id FROM relationships WHERE type = 'parent_child' AND to_person_id = ?"
  ).bind(personId).all();
  const parentIds = parentEdges.map(edge => (edge as any).from_person_id as string);
  if (parentIds.length) {
    const placeholders = parentIds.map(() => '?').join(', ');
    const { results: siblingChildren } = await db.prepare(
      `SELECT to_person_id FROM relationships WHERE type = 'parent_child' AND from_person_id IN (${placeholders}) AND to_person_id != ?`
    ).bind(...parentIds, personId).all();
    for (const rel of siblingChildren) {
      const siblingId = (rel as any).to_person_id as string;
      if (siblingId && siblingId !== personId) {
        ids.add(siblingId);
      }
    }
  }

  return [...ids];
}

async function ensureSiblingLink(db: D1Database, aId: string, bId: string, now: string) {
  if (aId === bId) return;
  const exists = await db.prepare(
    "SELECT id FROM relationships WHERE type = 'sibling' AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
  ).bind(aId, bId, bId, aId).first();
  if (exists) return;

  const link = await getSiblingLinkMeta(db, aId, bId);
  await db.prepare(
    "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'sibling', ?, ?)"
  ).bind(link.fromId, link.toId, link.metadata, now).run();
}

async function linkSiblingNetworks(db: D1Database, personA: string, personB: string, now: string) {
  const [siblingsA, siblingsB] = await Promise.all([
    getSiblingIds(db, personA),
    getSiblingIds(db, personB)
  ]);

  for (const siblingId of siblingsB) {
    if (siblingId !== personA) {
      await ensureSiblingLink(db, personA, siblingId, now);
    }
  }

  for (const siblingId of siblingsA) {
    if (siblingId !== personB) {
      await ensureSiblingLink(db, personB, siblingId, now);
    }
  }
}

async function ensureParentChildLink(db: D1Database, parentId: string, childId: string, now: string) {
  if (parentId === childId) return;
  const exists = await db.prepare(
    "SELECT id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id = ?"
  ).bind(parentId, childId).first();
  if (exists) return;

  const metadata = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
  await db.prepare(
    "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'parent_child', ?, ?)"
  ).bind(parentId, childId, metadata, now).run();
}

async function linkParentToSiblingChildren(db: D1Database, parentId: string, childId: string, now: string) {
  const siblingIds = await getSiblingIds(db, childId);
  for (const siblingId of siblingIds) {
    await ensureParentChildLink(db, parentId, siblingId, now);
    await linkSiblingNetworks(db, childId, siblingId, now);
  }
}

async function linkSpouseToChild(db: D1Database, parentId: string, childId: string, now: string) {
  const spouseRel = await db.prepare(
    "SELECT from_person_id, to_person_id FROM relationships WHERE type = 'spouse' AND (from_person_id = ? OR to_person_id = ?)"
  ).bind(parentId, parentId).first();

  if (!spouseRel) return null;

  const spouseId = (spouseRel as any).from_person_id === parentId
    ? (spouseRel as any).to_person_id
    : (spouseRel as any).from_person_id;

  const existingParentChild = await db.prepare(
    "SELECT id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id = ?"
  ).bind(spouseId, childId).first();

  if (existingParentChild) return null;

  const metadata = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
  await db.prepare(
    "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'parent_child', ?, ?)"
  ).bind(spouseId, childId, metadata, now).run();

  return spouseId as string;
}

export function registerRelationshipRoutes(app: Hono<AppBindings>) {
  // Get all relationships
  app.get('/api/relationships', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM relationships ORDER BY created_at'
    ).all();

    const parsedResults = results.map(rel => ({
      ...rel,
      metadata: safeParse(rel.metadata as string)
    }));

    return c.json(parsedResults);
  });

  // Create a relationship (link two people)
  app.post('/api/relationships', async (c) => {
    const body = await c.req.json();
    const { from_person_id, to_person_id, type, metadata, skipAutoLink, skip_auto_link } = body;
    const shouldSkipAutoLink = Boolean(skipAutoLink ?? skip_auto_link);

    if (!from_person_id || !to_person_id || !type) {
      return c.json({ error: 'from_person_id, to_person_id, and type are required' }, 400);
    }

    if (!['parent_child', 'spouse', 'ex_spouse', 'sibling', 'in_law'].includes(type)) {
      return c.json({ error: 'type must be parent_child, spouse, ex_spouse, sibling, or in_law' }, 400);
    }

    if (from_person_id === to_person_id) {
      return c.json({ error: 'Cannot link a person to themselves' }, 400);
    }

    // Verify both people exist
    const [fromExists, toExists] = await Promise.all([
      c.env.DB.prepare('SELECT id FROM people WHERE id = ?').bind(from_person_id).first(),
      c.env.DB.prepare('SELECT id FROM people WHERE id = ?').bind(to_person_id).first()
    ]);

    if (!fromExists || !toExists) {
      return c.json({ error: 'One or both people not found' }, 404);
    }

    const now = new Date().toISOString();
    let fromId = from_person_id;
    let toId = to_person_id;
    let finalMetadata = metadata ? JSON.stringify(metadata) : null;

    if (type === 'parent_child') {
      const existing = await c.env.DB.prepare(
        "SELECT id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id = ?"
      ).bind(from_person_id, to_person_id).first();
      if (existing) {
        return c.json({ error: 'Relationship already exists' }, 409);
      }

      await linkSpouseToChild(c.env.DB, from_person_id, to_person_id, now);
      if (finalMetadata === null) {
        finalMetadata = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
      }
    }

    if (type === 'spouse' || type === 'ex_spouse') {
      const existing = await c.env.DB.prepare(
        "SELECT id FROM relationships WHERE type = ? AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
      ).bind(type, from_person_id, to_person_id, to_person_id, from_person_id).first();
      if (existing) {
        return c.json({ error: 'Relationship already exists' }, 409);
      }
      fromId = from_person_id;
      toId = to_person_id;
      if (finalMetadata === null) {
        finalMetadata = JSON.stringify({ sourceHandle: 'right-s', targetHandle: 'left-t' });
      }
    }

    if (type === 'sibling') {
      const existing = await c.env.DB.prepare(
        "SELECT id FROM relationships WHERE type = 'sibling' AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
      ).bind(from_person_id, to_person_id, to_person_id, from_person_id).first();
      if (existing) {
        return c.json({ error: 'Relationship already exists' }, 409);
      }

      const link = await getSiblingLinkMeta(c.env.DB, from_person_id, to_person_id);
      fromId = link.fromId;
      toId = link.toId;
      finalMetadata = link.metadata;
    }

    if (type === 'in_law') {
      const existing = await c.env.DB.prepare(
        "SELECT id FROM relationships WHERE type = 'in_law' AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
      ).bind(from_person_id, to_person_id, to_person_id, from_person_id).first();
      if (existing) {
        return c.json({ error: 'Relationship already exists' }, 409);
      }
    }

    const result = await c.env.DB.prepare(
      'INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(fromId, toId, type, finalMetadata, now).run();

    if (type === 'parent_child' && !shouldSkipAutoLink) {
      await linkSpouseToChild(c.env.DB, from_person_id, to_person_id, now);
      await linkParentToSiblingChildren(c.env.DB, from_person_id, to_person_id, now);

      const otherChildren = await c.env.DB.prepare(
        "SELECT to_person_id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id != ?"
      ).bind(from_person_id, to_person_id).all();
      for (const child of otherChildren.results) {
        const siblingId = (child as any).to_person_id;
        const existingSibling = await c.env.DB.prepare(
          "SELECT id FROM relationships WHERE type = 'sibling' AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
        ).bind(to_person_id, siblingId, siblingId, to_person_id).first();
        if (!existingSibling) {
          const link = await getSiblingLinkMeta(c.env.DB, to_person_id, siblingId);
          await c.env.DB.prepare(
            "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'sibling', ?, ?)"
          ).bind(link.fromId, link.toId, link.metadata, now).run();
        }
        await linkSiblingNetworks(c.env.DB, to_person_id, siblingId, now);
      }
    }

    if (type === 'sibling' && !shouldSkipAutoLink) {
      await linkSiblingNetworks(c.env.DB, from_person_id, to_person_id, now);
    }

    return c.json({
      id: result.meta.last_row_id,
      from_person_id: fromId,
      to_person_id: toId,
      type,
      metadata: finalMetadata
    }, 201);
  });

  // Update a relationship
  app.put('/api/relationships/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { from_person_id, to_person_id, type, metadata, skipAutoLink, skip_auto_link } = body;
    const shouldSkipAutoLink = Boolean(skipAutoLink ?? skip_auto_link);

    const existing = await c.env.DB.prepare(
      'SELECT id, from_person_id, to_person_id, type FROM relationships WHERE id = ?'
    ).bind(id).first();

    if (!existing) {
      return c.json({ error: 'Relationship not found' }, 404);
    }

    if (type !== undefined) {
      if (!['parent_child', 'spouse', 'ex_spouse', 'sibling', 'in_law'].includes(type)) {
        return c.json({ error: 'type must be parent_child, spouse, ex_spouse, sibling, or in_law' }, 400);
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (from_person_id !== undefined) {
      updates.push('from_person_id = ?');
      values.push(from_person_id);
    }
    if (to_person_id !== undefined) {
      updates.push('to_person_id = ?');
      values.push(to_person_id);
    }
    if (type !== undefined) {
      updates.push('type = ?');
      values.push(type);
    }
    if (metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(metadata));
    }

    if (updates.length === 0) {
      return c.json({ error: 'No updates provided' }, 400);
    }

    values.push(id);

    await c.env.DB.prepare(
      `UPDATE relationships SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    const nextFrom = (from_person_id ?? (existing as any).from_person_id) as string;
    const nextTo = (to_person_id ?? (existing as any).to_person_id) as string;
    const nextType = type ?? (existing as any).type;
    const now = new Date().toISOString();

    if (nextType === 'parent_child' && !shouldSkipAutoLink) {
      await linkSpouseToChild(c.env.DB, nextFrom, nextTo, now);
      await linkParentToSiblingChildren(c.env.DB, nextFrom, nextTo, now);

      const otherChildren = await c.env.DB.prepare(
        "SELECT to_person_id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id != ?"
      ).bind(nextFrom, nextTo).all();
      for (const child of otherChildren.results) {
        const siblingId = (child as any).to_person_id;
        const existingSibling = await c.env.DB.prepare(
          "SELECT id FROM relationships WHERE type = 'sibling' AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
        ).bind(nextTo, siblingId, siblingId, nextTo).first();
        if (!existingSibling) {
          const link = await getSiblingLinkMeta(c.env.DB, nextTo, siblingId);
          await c.env.DB.prepare(
            "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'sibling', ?, ?)"
          ).bind(link.fromId, link.toId, link.metadata, now).run();
        }
        await linkSiblingNetworks(c.env.DB, nextTo, siblingId, now);
      }
    }

    if (nextType === 'sibling' && !shouldSkipAutoLink) {
      const link = await getSiblingLinkMeta(c.env.DB, nextFrom, nextTo);
      await c.env.DB.prepare(
        'UPDATE relationships SET from_person_id = ?, to_person_id = ?, metadata = ? WHERE id = ?'
      ).bind(link.fromId, link.toId, link.metadata, id).run();
      await linkSiblingNetworks(c.env.DB, nextFrom, nextTo, now);
    }

    const updated = await c.env.DB.prepare(
      'SELECT * FROM relationships WHERE id = ?'
    ).bind(id).first();

    return c.json(updated);
  });

  // Delete a relationship
  app.delete('/api/relationships/:id', async (c) => {
    try {
      const id = c.req.param('id');
      console.log(`DELETE /api/relationships/${id} request received`);

      const result = await c.env.DB.prepare(
        'DELETE FROM relationships WHERE id = ?'
      ).bind(id).run();

      console.log('Delete result:', JSON.stringify(result));

      if (result.success && (result.meta.changes ?? 0) > 0) {
        return c.json({ success: true, id });
      }
      return c.json({ error: 'Relationship not found' }, 404);
    } catch (error) {
      console.error('Error deleting relationship:', error);
      return c.json({ error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}
