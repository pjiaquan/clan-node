import type { Hono } from 'hono';
import type { AppBindings } from './types';
import { checkAndConsumeRateLimit, getRequestIpAddress } from './auth';
import { RELATIONSHIP_WRITE_RATE_LIMIT } from './rate_limits';
import { notifyUpdate } from './notify';
import { recordAuditLog, recordRateLimitAudit } from './audit';
import { createRelationshipRepository } from './d1_repositories';
import { assertLayerExists, DEFAULT_LAYER_ID, ensureLayerSchemaSupport, resolveLayerId } from './layers';
import {
  ensureParentChildLink,
  ensureSiblingLink,
  getPersonNameMap,
  getSiblingLinkMeta,
  isRelationshipType,
  linkParentToSiblingChildren,
  linkSiblingNetworks,
  linkSpousePairExistingChildren,
  linkSpouseToChild,
  parseRelationshipRows,
  PARENT_CHILD_METADATA,
  RELATIONSHIP_TYPES,
  summarizeRelationshipMetadata,
  SPOUSE_METADATA,
} from './relationships/service';

export function registerRelationshipRoutes(app: Hono<AppBindings>) {
  // Get all relationships
  app.get('/api/relationships', async (c) => {
    const layerId = resolveLayerId(c);
    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }
    const repository = createRelationshipRepository(c.env.DB);
    const results = await repository.listRelationships(layerId);
    const parsedResults = parseRelationshipRows(results);

    return c.json(parsedResults);
  });

  // Create a relationship (link two people)
  app.post('/api/relationships', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const rateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'relationship_write',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...RELATIONSHIP_WRITE_RATE_LIMIT
    });
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'relationship_write',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: '/api/relationships',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        summary: `關係寫入速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many relationship write requests' }, 429);
    }
    const body = await c.req.json();
    const layerId = resolveLayerId(c, body);
    const { from_person_id, to_person_id, type, metadata, skipAutoLink, skip_auto_link } = body;
    const shouldSkipAutoLink = Boolean(skipAutoLink ?? skip_auto_link);
    const createdRelationshipIds: number[] = [];

    if (!from_person_id || !to_person_id || !type) {
      return c.json({ error: 'from_person_id, to_person_id, and type are required' }, 400);
    }

    if (!isRelationshipType(type)) {
      return c.json({ error: 'type must be parent_child, spouse, ex_spouse, sibling, or in_law' }, 400);
    }

    if (from_person_id === to_person_id) {
      return c.json({ error: 'Cannot link a person to themselves' }, 400);
    }

    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }
    const repository = createRelationshipRepository(c.env.DB);
    // Verify both people exist
    const [fromExists, toExists] = await Promise.all([
      repository.personExists(layerId, from_person_id),
      repository.personExists(layerId, to_person_id)
    ]);

    if (!fromExists || !toExists) {
      return c.json({ error: 'One or both people not found' }, 404);
    }

    const now = new Date().toISOString();
    let fromId = from_person_id;
    let toId = to_person_id;
    let finalMetadata = metadata ? JSON.stringify(metadata) : null;

    if (type === 'parent_child') {
      const existing = await repository.findRelationship(layerId, 'parent_child', from_person_id, to_person_id);
      if (existing) {
        return c.json({ error: 'Relationship already exists' }, 409);
      }

      await linkSpouseToChild(repository, c.env, layerId, from_person_id, to_person_id, now, createdRelationshipIds);
      if (finalMetadata === null) {
        finalMetadata = PARENT_CHILD_METADATA;
      }
    }

    if (type === 'spouse' || type === 'ex_spouse') {
      const existing = await repository.findRelationship(layerId, type, from_person_id, to_person_id, true);
      if (existing) {
        return c.json({ error: 'Relationship already exists' }, 409);
      }
      fromId = from_person_id;
      toId = to_person_id;
      if (finalMetadata === null) {
        finalMetadata = SPOUSE_METADATA;
      }
    }

    if (type === 'sibling') {
      const existing = await repository.findRelationship(layerId, 'sibling', from_person_id, to_person_id, true);
      if (existing) {
        return c.json({ error: 'Relationship already exists' }, 409);
      }

      const preferredHandles = metadata && typeof metadata === 'object'
        ? {
          sourceHandle: (metadata as any).sourceHandle,
          targetHandle: (metadata as any).targetHandle
        }
        : undefined;
      const link = await getSiblingLinkMeta(repository, c.env, layerId, from_person_id, to_person_id, preferredHandles);
      fromId = link.fromId;
      toId = link.toId;
      finalMetadata = link.metadata;
    }

    if (type === 'in_law') {
      const existing = await repository.findRelationship(layerId, 'in_law', from_person_id, to_person_id, true);
      if (existing) {
        return c.json({ error: 'Relationship already exists' }, 409);
      }
    }

    const result = await repository.createRelationship({
      layerId,
      fromPersonId: fromId,
      toPersonId: toId,
      type,
      metadata: finalMetadata,
      createdAt: now,
    });
    const metadataSummary = summarizeRelationshipMetadata(finalMetadata);
    const metadataObject = metadataSummary && typeof metadataSummary === 'object'
      ? metadataSummary as Record<string, unknown>
      : null;
    const personNames = await getPersonNameMap(repository, layerId, [fromId, toId]);
    notifyUpdate(c, 'relationships:create', {
      id: result.lastRowId ?? undefined,
      from_person_id: fromId,
      to_person_id: toId,
      from_person_name: personNames.get(fromId) ?? null,
      to_person_name: personNames.get(toId) ?? null,
      type,
      source_handle: metadataObject?.sourceHandle,
      target_handle: metadataObject?.targetHandle
    });
    if (type === 'parent_child' && !shouldSkipAutoLink) {
      await linkSpouseToChild(repository, c.env, layerId, from_person_id, to_person_id, now, createdRelationshipIds);
      await linkParentToSiblingChildren(repository, c.env, layerId, from_person_id, to_person_id, now, createdRelationshipIds);

      const otherChildren = await repository.listChildrenForParent(layerId, from_person_id, to_person_id);
      for (const child of otherChildren) {
        const siblingId = (child as any).to_person_id;
        const existingSibling = await repository.findRelationship(layerId, 'sibling', to_person_id, siblingId, true);
        if (!existingSibling) {
          const link = await getSiblingLinkMeta(repository, c.env, layerId, to_person_id, siblingId);
          const siblingResult = await repository.createRelationship({
            layerId,
            fromPersonId: link.fromId,
            toPersonId: link.toId,
            type: 'sibling',
            metadata: link.metadata,
            createdAt: now,
          });
          if (siblingResult.lastRowId !== null) {
            createdRelationshipIds.push(siblingResult.lastRowId);
          }
        }
        await linkSiblingNetworks(repository, c.env, layerId, to_person_id, siblingId, now, createdRelationshipIds);
      }
    }

    if (type === 'sibling' && !shouldSkipAutoLink) {
      await linkSiblingNetworks(repository, c.env, layerId, from_person_id, to_person_id, now, createdRelationshipIds);
    }

    if (type === 'spouse' && !shouldSkipAutoLink) {
      await linkSpousePairExistingChildren(repository, c.env, layerId, fromId, toId, now, createdRelationshipIds);
    }

    await recordAuditLog(c, {
      action: 'create',
      resourceType: 'relationships',
      resourceId: result.lastRowId ?? null,
      summary: `新增關係 ${personNames.get(fromId) || fromId} -> ${personNames.get(toId) || toId}`,
      details: {
        from_person_id: fromId,
        to_person_id: toId,
        from_person_name: personNames.get(fromId) ?? null,
        to_person_name: personNames.get(toId) ?? null,
        type,
        created_relationship_ids: createdRelationshipIds
      }
    });

    return c.json({
      id: result.lastRowId,
      layer_id: layerId,
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
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const rateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'relationship_write',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...RELATIONSHIP_WRITE_RATE_LIMIT
    });
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'relationship_write',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: `/api/relationships/${id}`,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        summary: `關係更新速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many relationship write requests' }, 429);
    }
    const body = await c.req.json();
    const { from_person_id, to_person_id, type, metadata, skipAutoLink, skip_auto_link } = body;
    const shouldSkipAutoLink = Boolean(skipAutoLink ?? skip_auto_link);
    const repository = createRelationshipRepository(c.env.DB);

    await ensureLayerSchemaSupport(c.env.DB);
    const existing = await repository.getRelationshipById(id);

    if (!existing) {
      return c.json({ error: 'Relationship not found' }, 404);
    }

    const layerId = String((existing as any).layer_id || resolveLayerId(c, body));
    if (type !== undefined) {
      if (!isRelationshipType(type)) {
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

    const updatePayload = Object.fromEntries(updates.map((entry, index) => [entry.split(' = ')[0], values[index]]));
    await repository.updateRelationshipById(id, updatePayload);

    const nextFrom = (from_person_id ?? (existing as any).from_person_id) as string;
    const nextTo = (to_person_id ?? (existing as any).to_person_id) as string;
    const nextType = type ?? (existing as any).type;
    const now = new Date().toISOString();

    if (nextType === 'parent_child' && !shouldSkipAutoLink) {
      await linkSpouseToChild(repository, c.env, layerId, nextFrom, nextTo, now);
      await linkParentToSiblingChildren(repository, c.env, layerId, nextFrom, nextTo, now);

      const otherChildren = await repository.listChildrenForParent(layerId, nextFrom, nextTo);
      for (const child of otherChildren) {
        const siblingId = (child as any).to_person_id;
        const existingSibling = await repository.findRelationship(layerId, 'sibling', nextTo, siblingId, true);
        if (!existingSibling) {
          const link = await getSiblingLinkMeta(repository, c.env, layerId, nextTo, siblingId);
          await repository.createRelationship({
            layerId,
            fromPersonId: link.fromId,
            toPersonId: link.toId,
            type: 'sibling',
            metadata: link.metadata,
            createdAt: now,
          });
        }
        await linkSiblingNetworks(repository, c.env, layerId, nextTo, siblingId, now);
      }
    }

    if (nextType === 'sibling' && !shouldSkipAutoLink) {
      const preferredHandles = metadata && typeof metadata === 'object'
        ? {
          sourceHandle: (metadata as any).sourceHandle,
          targetHandle: (metadata as any).targetHandle
        }
        : undefined;
      const link = await getSiblingLinkMeta(repository, c.env, layerId, nextFrom, nextTo, preferredHandles);
      await repository.updateRelationshipById(id, {
        from_person_id: link.fromId,
        to_person_id: link.toId,
        metadata: link.metadata,
      });
      await linkSiblingNetworks(repository, c.env, layerId, nextFrom, nextTo, now);
    }

    if (nextType === 'spouse' && !shouldSkipAutoLink) {
      await linkSpousePairExistingChildren(repository, c.env, layerId, nextFrom, nextTo, now);
    }

    const updated = await repository.getRelationshipById(id);
    const personNames = await getPersonNameMap(repository, layerId, [nextFrom, nextTo]);

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
    await recordAuditLog(c, {
      action: 'update',
      resourceType: 'relationships',
      resourceId: id,
      summary: `更新關係 ${personNames.get(nextFrom) || nextFrom} -> ${personNames.get(nextTo) || nextTo}`,
      details: {
        changed_fields: changedFields,
        from_person_id: nextFrom,
        to_person_id: nextTo,
        from_person_name: personNames.get(nextFrom) ?? null,
        to_person_name: personNames.get(nextTo) ?? null,
        type: nextType
      }
    });
    return c.json(updated);
  });

  // Delete a relationship
  app.delete('/api/relationships/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const sessionUser = c.get('sessionUser');
      if (!sessionUser) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      const rateLimit = await checkAndConsumeRateLimit(c.env.DB, {
        action: 'relationship_write',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        ...RELATIONSHIP_WRITE_RATE_LIMIT
      });
      if (!rateLimit.allowed) {
        c.header('Retry-After', String(rateLimit.retryAfterSeconds));
        await recordRateLimitAudit(c, {
          action: 'relationship_write',
          limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
          route: `/api/relationships/${id}`,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          summary: `關係刪除速率限制：${sessionUser.username}`
        });
        return c.json({ error: 'Too many relationship write requests' }, 429);
      }
      console.log(`DELETE /api/relationships/${id} request received`);
      await ensureLayerSchemaSupport(c.env.DB);
      const repository = createRelationshipRepository(c.env.DB);
      const existing = await repository.getRelationshipById(id);
      if (!existing) {
        return c.json({ error: 'Relationship not found' }, 404);
      }
      const existingAny = existing as any;
      const layerId = String(existingAny.layer_id || DEFAULT_LAYER_ID);
      const personNames = await getPersonNameMap(repository, layerId, [
        existingAny.from_person_id as string,
        existingAny.to_person_id as string
      ]);

      const result = await repository.deleteRelationshipById(id);

      console.log('Delete result:', JSON.stringify(result));

      if (result.changes > 0) {
        notifyUpdate(c, 'relationships:delete', {
          id,
          from_person_id: existingAny.from_person_id as string,
          to_person_id: existingAny.to_person_id as string,
          from_person_name: personNames.get(existingAny.from_person_id as string) ?? null,
          to_person_name: personNames.get(existingAny.to_person_id as string) ?? null,
          type: existingAny.type as string
        });
        await recordAuditLog(c, {
          action: 'delete',
          resourceType: 'relationships',
          resourceId: id,
          summary: `刪除關係 ${personNames.get(existingAny.from_person_id as string) || existingAny.from_person_id} -> ${personNames.get(existingAny.to_person_id as string) || existingAny.to_person_id}`,
          details: {
            from_person_id: existingAny.from_person_id as string,
            to_person_id: existingAny.to_person_id as string,
            from_person_name: personNames.get(existingAny.from_person_id as string) ?? null,
            to_person_name: personNames.get(existingAny.to_person_id as string) ?? null,
            type: existingAny.type as string
          }
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
