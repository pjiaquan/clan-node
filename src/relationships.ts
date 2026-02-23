import type { Hono } from 'hono';
import type { AppBindings, Env } from './types';
import { safeParse } from './utils';
import { notifyUpdate } from './notify';

type SiblingHandlePreference = {
  sourceHandle?: string;
  targetHandle?: string;
};

function trackInsertedRelationshipId(result: any, collector?: number[]) {
  if (!collector) return;
  const rawId = result?.meta?.last_row_id;
  if (typeof rawId === 'number') {
    collector.push(rawId);
    return;
  }
  if (typeof rawId === 'string') {
    const parsed = Number(rawId);
    if (Number.isFinite(parsed)) {
      collector.push(parsed);
    }
  }
}

async function getSiblingLinkMeta(
  db: D1Database,
  aId: string,
  bId: string,
  preferredHandles?: SiblingHandlePreference
) {
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

  if (preferredHandles?.sourceHandle && preferredHandles?.targetHandle) {
    return {
      fromId: aId,
      toId: bId,
      metadata: JSON.stringify({
        sourceHandle: preferredHandles.sourceHandle,
        targetHandle: preferredHandles.targetHandle
      })
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

async function getPersonNameMap(
  db: D1Database,
  personIds: Array<string | null | undefined>
) {
  const uniqueIds = [...new Set(
    personIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  )];
  const map = new Map<string, string>();
  if (!uniqueIds.length) return map;

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const { results } = await db.prepare(
    `SELECT id, name FROM people WHERE id IN (${placeholders})`
  ).bind(...uniqueIds).all();

  for (const row of results) {
    const rowAny = row as any;
    if (typeof rowAny.id === 'string') {
      map.set(rowAny.id, typeof rowAny.name === 'string' ? rowAny.name : '');
    }
  }
  return map;
}

async function ensureSiblingLink(
  db: D1Database,
  aId: string,
  bId: string,
  now: string,
  createdRelationshipIds?: number[]
) {
  if (aId === bId) return;
  const exists = await db.prepare(
    "SELECT id FROM relationships WHERE type = 'sibling' AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
  ).bind(aId, bId, bId, aId).first();
  if (exists) return;

  const link = await getSiblingLinkMeta(db, aId, bId);
  const result = await db.prepare(
    "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'sibling', ?, ?)"
  ).bind(link.fromId, link.toId, link.metadata, now).run();
  trackInsertedRelationshipId(result, createdRelationshipIds);
}

async function linkSiblingNetworks(
  db: D1Database,
  personA: string,
  personB: string,
  now: string,
  createdRelationshipIds?: number[]
) {
  const [siblingsA, siblingsB] = await Promise.all([
    getSiblingIds(db, personA),
    getSiblingIds(db, personB)
  ]);

  for (const siblingId of siblingsB) {
    if (siblingId !== personA) {
      await ensureSiblingLink(db, personA, siblingId, now, createdRelationshipIds);
    }
  }

  for (const siblingId of siblingsA) {
    if (siblingId !== personB) {
      await ensureSiblingLink(db, personB, siblingId, now, createdRelationshipIds);
    }
  }
}

async function ensureParentChildLink(
  db: D1Database,
  parentId: string,
  childId: string,
  now: string,
  createdRelationshipIds?: number[]
) {
  if (parentId === childId) return;
  const exists = await db.prepare(
    "SELECT id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id = ?"
  ).bind(parentId, childId).first();
  if (exists) return;

  const metadata = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
  const result = await db.prepare(
    "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'parent_child', ?, ?)"
  ).bind(parentId, childId, metadata, now).run();
  trackInsertedRelationshipId(result, createdRelationshipIds);
}

async function linkParentToSiblingChildren(
  db: D1Database,
  parentId: string,
  childId: string,
  now: string,
  createdRelationshipIds?: number[]
) {
  const siblingIds = await getSiblingIds(db, childId);
  for (const siblingId of siblingIds) {
    await ensureParentChildLink(db, parentId, siblingId, now, createdRelationshipIds);
    await linkSiblingNetworks(db, childId, siblingId, now, createdRelationshipIds);
  }
}

async function getChildIds(db: D1Database, parentId: string) {
  const { results } = await db.prepare(
    "SELECT to_person_id FROM relationships WHERE type = 'parent_child' AND from_person_id = ?"
  ).bind(parentId).all();
  return results
    .map((row) => (row as any).to_person_id as string)
    .filter(Boolean);
}

async function linkSpouseToChild(
  db: D1Database,
  parentId: string,
  childId: string,
  now: string,
  createdRelationshipIds?: number[]
) {
  const { results } = await db.prepare(
    "SELECT from_person_id, to_person_id FROM relationships WHERE type = 'spouse' AND (from_person_id = ? OR to_person_id = ?)"
  ).bind(parentId, parentId).all();

  const spouseIds = new Set<string>();
  for (const rel of results) {
    const spouseId = (rel as any).from_person_id === parentId
      ? (rel as any).to_person_id
      : (rel as any).from_person_id;
    if (spouseId && spouseId !== parentId) {
      spouseIds.add(spouseId as string);
    }
  }

  if (!spouseIds.size) return [] as string[];

  const linked: string[] = [];
  for (const spouseId of spouseIds) {
    const existingParentChild = await db.prepare(
      "SELECT id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id = ?"
    ).bind(spouseId, childId).first();

    if (!existingParentChild) {
      const metadata = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
      const result = await db.prepare(
        "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'parent_child', ?, ?)"
      ).bind(spouseId, childId, metadata, now).run();
      trackInsertedRelationshipId(result, createdRelationshipIds);
    }

    await linkParentToSiblingChildren(db, spouseId, childId, now, createdRelationshipIds);
    linked.push(spouseId);
  }

  return linked;
}

async function linkSpousePairExistingChildren(
  db: D1Database,
  personA: string,
  personB: string,
  now: string,
  createdRelationshipIds?: number[]
) {
  const [aChildren, bChildren] = await Promise.all([
    getChildIds(db, personA),
    getChildIds(db, personB)
  ]);

  for (const childId of aChildren) {
    await ensureParentChildLink(db, personB, childId, now, createdRelationshipIds);
    await linkParentToSiblingChildren(db, personB, childId, now, createdRelationshipIds);
  }

  for (const childId of bChildren) {
    await ensureParentChildLink(db, personA, childId, now, createdRelationshipIds);
    await linkParentToSiblingChildren(db, personA, childId, now, createdRelationshipIds);
  }
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
    const createdRelationshipIds: number[] = [];

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

      await linkSpouseToChild(c.env.DB, from_person_id, to_person_id, now, createdRelationshipIds);
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

      const preferredHandles = metadata && typeof metadata === 'object'
        ? {
          sourceHandle: (metadata as any).sourceHandle,
          targetHandle: (metadata as any).targetHandle
        }
        : undefined;
      const link = await getSiblingLinkMeta(c.env.DB, from_person_id, to_person_id, preferredHandles);
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
    trackInsertedRelationshipId(result, createdRelationshipIds);

    const metadataSummary = typeof finalMetadata === 'string'
      ? safeParse(finalMetadata)
      : finalMetadata;
    const personNames = await getPersonNameMap(c.env.DB, [fromId, toId]);
    notifyUpdate(c, 'relationships:create', {
      id: result.meta.last_row_id ?? undefined,
      from_person_id: fromId,
      to_person_id: toId,
      from_person_name: personNames.get(fromId) ?? null,
      to_person_name: personNames.get(toId) ?? null,
      type,
      source_handle: metadataSummary?.sourceHandle,
      target_handle: metadataSummary?.targetHandle
    });
    if (type === 'parent_child' && !shouldSkipAutoLink) {
      await linkSpouseToChild(c.env.DB, from_person_id, to_person_id, now, createdRelationshipIds);
      await linkParentToSiblingChildren(c.env.DB, from_person_id, to_person_id, now, createdRelationshipIds);

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
          const siblingResult = await c.env.DB.prepare(
            "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'sibling', ?, ?)"
          ).bind(link.fromId, link.toId, link.metadata, now).run();
          trackInsertedRelationshipId(siblingResult, createdRelationshipIds);
        }
        await linkSiblingNetworks(c.env.DB, to_person_id, siblingId, now, createdRelationshipIds);
      }
    }

    if (type === 'sibling' && !shouldSkipAutoLink) {
      await linkSiblingNetworks(c.env.DB, from_person_id, to_person_id, now, createdRelationshipIds);
    }

    if (type === 'spouse' && !shouldSkipAutoLink) {
      await linkSpousePairExistingChildren(c.env.DB, fromId, toId, now, createdRelationshipIds);
    }

    return c.json({
      id: result.meta.last_row_id,
      from_person_id: fromId,
      to_person_id: toId,
      type,
      metadata: finalMetadata,
      created_relationship_ids: createdRelationshipIds
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
    const changedFields: string[] = [];

    if (from_person_id !== undefined) {
      updates.push('from_person_id = ?');
      values.push(from_person_id);
      changedFields.push('from_person_id');
    }
    if (to_person_id !== undefined) {
      updates.push('to_person_id = ?');
      values.push(to_person_id);
      changedFields.push('to_person_id');
    }
    if (type !== undefined) {
      updates.push('type = ?');
      values.push(type);
      changedFields.push('type');
    }
    if (metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(metadata));
      changedFields.push('metadata');
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
      const preferredHandles = metadata && typeof metadata === 'object'
        ? {
          sourceHandle: (metadata as any).sourceHandle,
          targetHandle: (metadata as any).targetHandle
        }
        : undefined;
      const link = await getSiblingLinkMeta(c.env.DB, nextFrom, nextTo, preferredHandles);
      await c.env.DB.prepare(
        'UPDATE relationships SET from_person_id = ?, to_person_id = ?, metadata = ? WHERE id = ?'
      ).bind(link.fromId, link.toId, link.metadata, id).run();
      await linkSiblingNetworks(c.env.DB, nextFrom, nextTo, now);
    }

    if (nextType === 'spouse' && !shouldSkipAutoLink) {
      await linkSpousePairExistingChildren(c.env.DB, nextFrom, nextTo, now);
    }

    const updated = await c.env.DB.prepare(
      'SELECT * FROM relationships WHERE id = ?'
    ).bind(id).first();
    const personNames = await getPersonNameMap(c.env.DB, [nextFrom, nextTo]);

    const updateDetails: Record<string, unknown> = {
      id,
      changed: changedFields,
      from_person_id: nextFrom,
      to_person_id: nextTo,
      from_person_name: personNames.get(nextFrom) ?? null,
      to_person_name: personNames.get(nextTo) ?? null,
      type: nextType
    };
    if (metadata !== undefined && typeof metadata === 'object') {
      updateDetails.source_handle = (metadata as any)?.sourceHandle;
      updateDetails.target_handle = (metadata as any)?.targetHandle;
    }
    notifyUpdate(c, 'relationships:update', updateDetails);
    return c.json(updated);
  });

  // Delete a relationship
  app.delete('/api/relationships/:id', async (c) => {
    try {
      const id = c.req.param('id');
      console.log(`DELETE /api/relationships/${id} request received`);
      const existing = await c.env.DB.prepare(
        'SELECT id, from_person_id, to_person_id, type FROM relationships WHERE id = ?'
      ).bind(id).first();
      if (!existing) {
        return c.json({ error: 'Relationship not found' }, 404);
      }
      const existingAny = existing as any;
      const personNames = await getPersonNameMap(c.env.DB, [
        existingAny.from_person_id as string,
        existingAny.to_person_id as string
      ]);

      const result = await c.env.DB.prepare(
        'DELETE FROM relationships WHERE id = ?'
      ).bind(id).run();

      console.log('Delete result:', JSON.stringify(result));

      if (result.success && (result.meta.changes ?? 0) > 0) {
        notifyUpdate(c, 'relationships:delete', {
          id,
          from_person_id: existingAny.from_person_id as string,
          to_person_id: existingAny.to_person_id as string,
          from_person_name: personNames.get(existingAny.from_person_id as string) ?? null,
          to_person_name: personNames.get(existingAny.to_person_id as string) ?? null,
          type: existingAny.type as string
        });
        return c.json({ success: true, id });
      }
      return c.json({ error: 'Relationship not found' }, 404);
    } catch (error) {
      console.error('Error deleting relationship:', error);
      return c.json({ error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}
