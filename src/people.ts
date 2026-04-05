import type { Hono } from 'hono';
import type { AppBindings } from './types';
import { createPeopleRepository } from './d1_repositories';
import { notifyUpdate } from './notify';
import { queueRemoteJson } from './dual_write';
import { recordAuditLog, recordRateLimitAudit } from './audit';
import { checkAndConsumeRateLimit, getRequestIpAddress } from './auth';
import { PEOPLE_CREATE_RATE_LIMIT } from './rate_limits';
import {
  decryptPersonRow,
  migratePlaintextPersonRow,
  protectPersonWriteFields,
  encryptProtectedValue
} from './data_protection';
import { assertLayerExists, ensureLayerSchemaSupport, resolveLayerId } from './layers';
import { getPeopleSchemaSupport } from './schema';
import {
  appendAvatar,
  deriveStorageKeyFromUrl,
  ensureAvatarFromLegacy,
  handleAvatarUpload,
  isUploadFile,
  loadAvatarMap,
  loadPersonAvatars,
  normalizeAvatar,
  resolvePrimaryAvatar,
  syncPrimaryAvatar,
  type PersonAvatar,
} from './people/avatar_service';
import {
  buildPersonUpdatePayload,
  buildPersonPayload,
  ensurePersonExists,
  extractCustomFields,
  loadCustomFields,
  loadPersonCustomFields,
  lookupVerifiedEmailAtFromRepository,
  normalizeEmail,
  parseBoolean,
  updateSiblingOrdering,
} from './people/person_service';

export function registerPeopleRoutes(app: Hono<AppBindings>) {
  const MAX_AVATAR_BYTES = 20 * 1024 * 1024;
  const avatarSelectSql = `
    SELECT id, person_id, avatar_url, storage_key, is_primary, sort_order, created_at, updated_at
    FROM person_avatars
  `;

  // Get all people
  app.get('/api/people', async (c) => {
    const layerId = resolveLayerId(c);
    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }
    const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
    const repository = createPeopleRepository(c.env.DB);
    const results = await repository.listPeople(layerId, peopleSchema.hasEmail);
    await Promise.all(results.map((row) => migratePlaintextPersonRow(c.env.DB, c.env, row)));
    const customFieldsMap = await loadCustomFields(c.env, repository, layerId);
    const avatarMap = await loadAvatarMap(c.env.DB);

    const parsedResults = await Promise.all(results.map(async (person: any) => {
      const decryptedPerson = await decryptPersonRow(c.env, person);
      const avatars = avatarMap.get(decryptedPerson.id) || await ensureAvatarFromLegacy(c.env.DB, decryptedPerson);
      const emailVerifiedAt = await lookupVerifiedEmailAtFromRepository(c.env.DB, repository, (decryptedPerson as any).email ?? null);
      return buildPersonPayload(decryptedPerson, customFieldsMap.get(decryptedPerson.id) || [], avatars, resolvePrimaryAvatar, emailVerifiedAt);
    }));

    return c.json({ people: parsedResults });
  });

  // Get a single person by ID
  app.get('/api/people/:id', async (c) => {
    const id = c.req.param('id');
    const layerId = resolveLayerId(c);
    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }
    const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
    const repository = createPeopleRepository(c.env.DB);
    const person = await repository.getPersonByIdInLayerDetailed(id, layerId, peopleSchema.hasEmail);

    if (!person) {
      return c.json({ error: 'Person not found' }, 404);
    }
    await migratePlaintextPersonRow(c.env.DB, c.env, person as Record<string, unknown>);
    const decryptedPerson = await decryptPersonRow(c.env, person as Record<string, unknown>);
    const customFields = await loadPersonCustomFields(c.env, repository, id);
    const avatars = await ensureAvatarFromLegacy(c.env.DB, decryptedPerson as any);
    const emailVerifiedAt = await lookupVerifiedEmailAtFromRepository(c.env.DB, repository, (decryptedPerson as any).email ?? null);
    return c.json(buildPersonPayload(decryptedPerson, customFields, avatars, resolvePrimaryAvatar, emailVerifiedAt));
  });

  // List avatars for a single person
  app.get('/api/people/:id/avatars', async (c) => {
    const id = c.req.param('id');
    const layerId = resolveLayerId(c);
    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }
    const repository = createPeopleRepository(c.env.DB);
    const existing = await repository.getPersonSummaryByIdInLayer(id, layerId);

    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }

    const avatars = await ensureAvatarFromLegacy(c.env.DB, existing as any);
    return c.json({
      person_id: id,
      avatar_url: resolvePrimaryAvatar(avatars)?.avatar_url || (existing as any).avatar_url || null,
      avatars
    });
  });

  // Create a new person
  app.post('/api/people', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const peopleCreateRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'people_create',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...PEOPLE_CREATE_RATE_LIMIT
    });
    if (!peopleCreateRateLimit.allowed) {
      c.header('Retry-After', String(peopleCreateRateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'people_create',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: '/api/people',
        retryAfterSeconds: peopleCreateRateLimit.retryAfterSeconds,
        summary: `人物建立速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many create requests' }, 429);
    }
    const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
    const repository = createPeopleRepository(c.env.DB);
    const body = await c.req.json();
    const layerId = resolveLayerId(c, body);
    const { id: providedId, name, english_name, email, gender, blood_type, dob, dod, tob, tod, avatar_url, metadata } = body;

    if (!name) {
      return c.json({ error: 'Name is required' }, 400);
    }
    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }

    const id = providedId || crypto.randomUUID();
    const now = new Date().toISOString();
    const normalizedEmail = normalizeEmail(email);
    const protectedFields = await protectPersonWriteFields(c.env, {
      blood_type: blood_type || null,
      dob: dob || null,
      dod: dod || null,
      tob: tob || null,
      tod: tod || null,
      metadata: metadata ? JSON.stringify(metadata) : null
    });

    const insertColumns = ['id', 'layer_id', 'name', 'english_name'];
    const insertValues: unknown[] = [id, layerId, name, english_name || null];
    if (peopleSchema.hasEmail) {
      insertColumns.push('email');
      insertValues.push(normalizedEmail);
    }
    insertColumns.push('gender', 'blood_type', 'dob', 'dod', 'tob', 'tod', 'avatar_url', 'metadata', 'created_at', 'updated_at');
    insertValues.push(
      gender || 'O',
      protectedFields.blood_type ?? null,
      protectedFields.dob ?? null,
      protectedFields.dod ?? null,
      protectedFields.tob ?? null,
      protectedFields.tod ?? null,
      avatar_url || null,
      protectedFields.metadata ?? null,
      now,
      now
    );
    await repository.insertPerson(Object.fromEntries(insertColumns.map((column, index) => [column, insertValues[index]])));

    const customFields = extractCustomFields(body, metadata);
    if (customFields) {
      for (const field of customFields) {
        if (!field?.label && !field?.value) continue;
        await repository.insertCustomField({
          personId: id,
          label: field.label || '',
          value: (await encryptProtectedValue(c.env, field.value || '')) || '',
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const inputAvatars = Array.isArray(body?.avatars) ? body.avatars : [];
    if (inputAvatars.length > 0) {
      const candidates = inputAvatars
        .map((entry: any, index: number) => ({
          avatar_url: typeof entry?.avatar_url === 'string' ? entry.avatar_url.trim() : '',
          is_primary: entry?.is_primary === true,
          sort_order: Number.isFinite(entry?.sort_order) ? Number(entry.sort_order) : index
        }))
        .filter((entry: any) => Boolean(entry.avatar_url));

      let primaryPicked = false;
      for (const entry of candidates) {
        const makePrimary = entry.is_primary === true || (!primaryPicked && !candidates.some((candidate: any) => candidate.is_primary === true));
        await appendAvatar(
          c.env.DB,
          id,
          entry.avatar_url,
          deriveStorageKeyFromUrl(entry.avatar_url),
          {
            now,
            isPrimary: makePrimary,
            sortOrder: entry.sort_order
          }
        );
        if (makePrimary) primaryPicked = true;
      }
    } else if (avatar_url) {
      await appendAvatar(
        c.env.DB,
        id,
        avatar_url,
        deriveStorageKeyFromUrl(avatar_url),
        { now, isPrimary: true }
      );
    }

    const person = await repository.getPersonById(id, peopleSchema.hasEmail);

    const customFieldsResult = await loadPersonCustomFields(c.env, repository, id);
    const decryptedPerson = person ? await decryptPersonRow(c.env, person as Record<string, unknown>) : null;
    const avatars = decryptedPerson ? await ensureAvatarFromLegacy(c.env.DB, decryptedPerson as any) : [];
    const metadataKeys = metadata && typeof metadata === 'object'
      ? Object.keys(metadata as Record<string, unknown>)
      : [];
    const customFieldsCount = Array.isArray(customFields) ? customFields.length : 0;
    const customFieldLabels = Array.isArray(customFields)
      ? customFields.map(field => String(field?.label || '')).filter(Boolean)
      : [];
    const avatarLink = avatar_url ? new URL(avatar_url, c.req.url).toString() : undefined;
    notifyUpdate(c, 'people:create', {
      id,
      layer_id: layerId,
      name,
      english_name,
      email: normalizedEmail,
      gender,
      avatar_url,
      avatars_count: avatars.length,
      metadata_keys: metadataKeys,
      custom_fields_count: customFieldsCount,
      custom_field_labels: customFieldLabels,
      has_protected_fields: Boolean(blood_type || dob || dod || tob || tod)
    }, avatarLink ? { photoUrl: avatarLink } : undefined);
    await recordAuditLog(c, {
      action: 'create',
      resourceType: 'people',
      resourceId: id,
      summary: `新增人物 ${name}`,
      details: {
        name,
        english_name: english_name || null,
        email: normalizedEmail,
        gender: gender || 'O',
        avatar_url: avatar_url || null,
        avatars_count: avatars.length,
        metadata_keys: metadataKeys,
        custom_fields_count: customFieldsCount,
        custom_field_labels: customFieldLabels,
        has_protected_fields: Boolean(blood_type || dob || dod || tob || tod)
      }
    });

    const mirrorPayload: Record<string, unknown> = {
      id,
      name,
      english_name: english_name || null,
      email: normalizedEmail,
      gender: gender || 'O',
      blood_type: blood_type || null,
      dob: dob || null,
      dod: dod || null,
      tob: tob || null,
      tod: tod || null,
      avatar_url: avatar_url || null,
      layer_id: layerId,
      avatars: avatars.map((avatar) => ({
        id: avatar.id,
        avatar_url: avatar.avatar_url,
        is_primary: avatar.is_primary,
        sort_order: avatar.sort_order
      })),
      metadata: metadata || null
    };
    if (customFields) {
      mirrorPayload.custom_fields = customFields;
    }
    queueRemoteJson(c, 'POST', '/api/people', mirrorPayload);

    const emailVerifiedAt = await lookupVerifiedEmailAtFromRepository(c.env.DB, repository, (decryptedPerson as any).email ?? null);
    if (!decryptedPerson) {
      return c.json({ error: 'Failed to load created person' }, 500);
    }
    return c.json(buildPersonPayload(decryptedPerson, customFieldsResult, avatars, resolvePrimaryAvatar, emailVerifiedAt), 201);
  });

  // Update a person
  app.put('/api/people/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const layerId = resolveLayerId(c, body);
    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }
    const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
    const repository = createPeopleRepository(c.env.DB);
    const { name, english_name, email, gender, blood_type, dob, dod, tob, tod, avatar_url, metadata } = body;

    const existing = await repository.getPersonByIdInLayerDetailed(id, layerId, peopleSchema.hasEmail);

    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }
    await migratePlaintextPersonRow(c.env.DB, c.env, existing as Record<string, unknown>);
    const existingAny = await decryptPersonRow(c.env, existing as Record<string, unknown>) as any;
    const previousDob = existingAny.dob as string | null;
    const existingCustomFields = await loadPersonCustomFields(c.env, repository, id);
    await ensureAvatarFromLegacy(c.env.DB, existingAny);

    const now = new Date().toISOString();
    const protectedUpdates = await protectPersonWriteFields(c.env, {
      blood_type: blood_type !== undefined ? (blood_type as string | null) : undefined,
      dob: dob !== undefined ? (dob as string | null) : undefined,
      dod: dod !== undefined ? (dod as string | null) : undefined,
      tob: tob !== undefined ? (tob as string | null) : undefined,
      tod: tod !== undefined ? (tod as string | null) : undefined,
      metadata: metadata !== undefined ? (metadata ? JSON.stringify(metadata) : null) : undefined
    });
    const normalizedNextEmail = peopleSchema.hasEmail && email !== undefined ? normalizeEmail(email) : undefined;

    if (peopleSchema.hasEmail && email !== undefined) {
      const existingEmail = normalizeEmail(existingAny.email);
      const verifiedEmailAt = await lookupVerifiedEmailAtFromRepository(c.env.DB, repository, existingEmail);
      if (verifiedEmailAt && normalizedNextEmail !== existingEmail) {
        return c.json({ error: 'Verified email can only be changed from the account page' }, 409);
      }
    }
    const { updatePayload, changedFields } = buildPersonUpdatePayload({
      name,
      english_name,
      normalizedEmail: normalizedNextEmail,
      includeEmail: peopleSchema.hasEmail,
      gender,
      avatar_url,
      metadataProtected: metadata !== undefined ? (protectedUpdates.metadata ?? null) : undefined,
      protectedUpdates,
      now,
    });

    const customFields = extractCustomFields(body, metadata);

    if (Object.keys(updatePayload).length > 0) {
      await repository.updatePersonById(id, updatePayload);
    } else if (customFields !== null) {
      await repository.updatePersonById(id, { updated_at: now });
    } else {
      return c.json({ error: 'No fields to update' }, 400);
    }

    if (customFields !== null) {
      await repository.deleteCustomFieldsByPersonId(id);
      for (const field of customFields) {
        if (!field?.label && !field?.value) continue;
        await repository.insertCustomField({
          personId: id,
          label: field.label || '',
          value: (await encryptProtectedValue(c.env, field.value || '')) || '',
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (avatar_url !== undefined) {
      if (!avatar_url) {
        await c.env.DB.prepare(
          'UPDATE person_avatars SET is_primary = 0, updated_at = ? WHERE person_id = ? AND is_primary = 1'
        ).bind(now, id).run();
        await repository.updatePersonById(id, { avatar_url: null, updated_at: now });
      } else {
        const existingAvatar = await c.env.DB.prepare(
          'SELECT id FROM person_avatars WHERE person_id = ? AND avatar_url = ? LIMIT 1'
        ).bind(id, avatar_url).first();
        if (existingAvatar) {
          await syncPrimaryAvatar(c.env.DB, id, now, (existingAvatar as any).id as string);
        } else {
          await appendAvatar(
            c.env.DB,
            id,
            avatar_url,
            deriveStorageKeyFromUrl(avatar_url),
            { now, isPrimary: true }
          );
        }
      }
    }

    if (dob !== undefined && dob !== previousDob) {
      await updateSiblingOrdering(c.env, repository, id, String(existingAny.layer_id || 'default'));
    }

    const person = await repository.getPersonByIdInLayerDetailed(id, layerId, peopleSchema.hasEmail);

    const customFieldsResult = await loadPersonCustomFields(c.env, repository, id);
    const decryptedPerson = person ? await decryptPersonRow(c.env, person as Record<string, unknown>) : null;
    const avatars = decryptedPerson ? await ensureAvatarFromLegacy(c.env.DB, decryptedPerson as any) : [];
    const formatCustomFields = (fields: { label: string; value: string }[]) => (
      fields.map((field) => ({
        label: field.label || '',
        value: field.value || ''
      }))
    );

    const personName = name !== undefined ? name : (existingAny.name ?? null);
    const updateDetails: Record<string, unknown> = {
      id,
      person_name: personName,
      changed: changedFields
    };
    if (name !== undefined) {
      updateDetails.name = {
        old: existingAny.name ?? null,
        new: name
      };
    }
    if (english_name !== undefined) {
      updateDetails.english_name = {
        old: existingAny.english_name ?? null,
        new: english_name
      };
    }
    if (peopleSchema.hasEmail && email !== undefined) {
      updateDetails.email = {
        old: existingAny.email ?? null,
        new: normalizeEmail(email)
      };
    }
    if (gender !== undefined) updateDetails.gender = gender;
    if (blood_type !== undefined) updateDetails.blood_type_updated = true;
    if (dob !== undefined) updateDetails.dob_updated = true;
    if (dod !== undefined) updateDetails.dod_updated = true;
    if (tob !== undefined) updateDetails.tob_updated = true;
    if (tod !== undefined) updateDetails.tod_updated = true;
    let avatarLink: string | undefined;
    if (avatar_url !== undefined) {
      const prevAvatar = existingAny.avatar_url ?? null;
      const currentPrimary = resolvePrimaryAvatar(avatars)?.avatar_url || null;
      updateDetails.avatar_url = {
        old: prevAvatar,
        new: currentPrimary
      };
      if (currentPrimary) {
        avatarLink = new URL(currentPrimary, c.req.url).toString();
      }
    }
    if (metadata !== undefined && typeof metadata === 'object') {
      updateDetails.metadata_keys = Object.keys(metadata as Record<string, unknown>);
    }
    if (customFields !== null) {
      const nextFields = Array.isArray(customFields) ? customFields : [];
      const previousFields = formatCustomFields(existingCustomFields);
      const formattedNext = formatCustomFields(nextFields);
      if (JSON.stringify(previousFields) !== JSON.stringify(formattedNext)) {
        updateDetails.custom_fields = {
          old_labels: previousFields.map((field) => field.label),
          new_labels: formattedNext.map((field) => field.label)
        };
        updateDetails.custom_fields_count = formattedNext.length;
      }
    }
    notifyUpdate(c, 'people:update', updateDetails, avatarLink ? { photoUrl: avatarLink } : undefined);
    await recordAuditLog(c, {
      action: 'update',
      resourceType: 'people',
      resourceId: id,
      summary: `更新人物 ${String(personName || id)}`,
      details: {
        changed_fields: changedFields,
        name: personName,
        custom_fields_updated: customFields !== null
      }
    });
    queueRemoteJson(c, 'PUT', `/api/people/${id}`, body);
    const emailVerifiedAt = await lookupVerifiedEmailAtFromRepository(c.env.DB, repository, (decryptedPerson as any).email ?? null);
    if (!decryptedPerson) {
      return c.json({ error: 'Failed to load updated person' }, 500);
    }
    return c.json(buildPersonPayload(decryptedPerson, customFieldsResult, avatars, resolvePrimaryAvatar, emailVerifiedAt));
  });

  // Upload avatar for a person (multi-avatar API)
  app.post('/api/people/:id/avatars', async (c) => {
    try {
      const id = c.req.param('id');
      const layerId = resolveLayerId(c);
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!isUploadFile(file)) {
        return c.json({ error: 'file is required' }, 400);
      }
      const setPrimary = parseBoolean(formData.get('set_primary'), true);
      return handleAvatarUpload(c, id, file, {
        maxAvatarBytes: MAX_AVATAR_BYTES,
        ensurePersonExists: (db, personId) => ensurePersonExists(createPeopleRepository(db), db, personId, layerId, ensureAvatarFromLegacy),
        setPrimary,
        mirrorPath: `/api/people/${id}/avatars`,
        mirrorSetPrimary: setPrimary,
        notifySource: 'multi'
      });
    } catch (error) {
      console.error('Avatar upload failed:', error);
      return c.json({ error: 'Avatar upload failed' }, 500);
    }
  });

  // Backward-compatible single-avatar endpoint
  app.post('/api/people/:id/avatar', async (c) => {
    try {
      const id = c.req.param('id');
      const layerId = resolveLayerId(c);
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!isUploadFile(file)) {
        return c.json({ error: 'file is required' }, 400);
      }
      return handleAvatarUpload(c, id, file, {
        maxAvatarBytes: MAX_AVATAR_BYTES,
        ensurePersonExists: (db, personId) => ensurePersonExists(createPeopleRepository(db), db, personId, layerId, ensureAvatarFromLegacy),
        setPrimary: true,
        mirrorPath: `/api/people/${id}/avatar`,
        notifySource: 'legacy'
      });
    } catch (error) {
      console.error('Avatar upload failed:', error);
      return c.json({ error: 'Avatar upload failed' }, 500);
    }
  });

  // Update avatar metadata (set primary / reorder)
  app.put('/api/people/:id/avatars/:avatarId', async (c) => {
    const id = c.req.param('id');
    const avatarId = c.req.param('avatarId');
    const body = await c.req.json();
    const layerId = resolveLayerId(c, body);
    const now = new Date().toISOString();
    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }

    const repository = createPeopleRepository(c.env.DB);
    const existing = await ensurePersonExists(repository, c.env.DB, id, layerId, ensureAvatarFromLegacy);
    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }

    const avatar = await c.env.DB.prepare(
      'SELECT id, person_id FROM person_avatars WHERE id = ? AND person_id = ?'
    ).bind(avatarId, id).first();

    if (!avatar) {
      return c.json({ error: 'Avatar not found' }, 404);
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    const wantsPrimary = body?.is_primary === true;
    if (Number.isFinite(body?.sort_order)) {
      updates.push('sort_order = ?');
      values.push(Number(body.sort_order));
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(avatarId);
      values.push(id);
      await c.env.DB.prepare(
        `UPDATE person_avatars SET ${updates.join(', ')} WHERE id = ? AND person_id = ?`
      ).bind(...values).run();
    }

    const synced = await syncPrimaryAvatar(c.env.DB, id, now, wantsPrimary ? avatarId : undefined);

    await recordAuditLog(c, {
      action: 'update_avatar',
      resourceType: 'people',
      resourceId: id,
      summary: `更新人物頭像設定 ${String(existing.name ?? id)}`,
      details: {
        avatar_id: avatarId,
        is_primary: wantsPrimary,
        sort_order: Number.isFinite(body?.sort_order) ? Number(body.sort_order) : undefined
      }
    });

    queueRemoteJson(c, 'PUT', `/api/people/${id}/avatars/${avatarId}`, body);

    return c.json({
      avatar: synced.avatars.find((item) => item.id === avatarId) || null,
      avatars: synced.avatars,
      avatar_url: synced.primary?.avatar_url || null
    });
  });

  // Delete one avatar for a person
  app.delete('/api/people/:id/avatars/:avatarId', async (c) => {
    const id = c.req.param('id');
    const avatarId = c.req.param('avatarId');
    const layerId = resolveLayerId(c);
    const now = new Date().toISOString();
    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }

    const repository = createPeopleRepository(c.env.DB);
    const existing = await ensurePersonExists(repository, c.env.DB, id, layerId, ensureAvatarFromLegacy);
    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }

    const avatar = await c.env.DB.prepare(
      `${avatarSelectSql} WHERE id = ? AND person_id = ? LIMIT 1`
    ).bind(avatarId, id).first();

    if (!avatar) {
      return c.json({ error: 'Avatar not found' }, 404);
    }

    const normalized = normalizeAvatar(avatar);
    await c.env.DB.prepare(
      'DELETE FROM person_avatars WHERE id = ? AND person_id = ?'
    ).bind(avatarId, id).run();

    const key = normalized.storage_key || deriveStorageKeyFromUrl(normalized.avatar_url);
    if (key) {
      await c.env.AVATARS.delete(key);
    }

    const synced = await syncPrimaryAvatar(c.env.DB, id, now);
    await recordAuditLog(c, {
      action: 'update_avatar',
      resourceType: 'people',
      resourceId: id,
      summary: `刪除人物頭像 ${String(existing.name ?? id)}`,
      details: {
        avatar_id: avatarId,
        avatar_url: normalized.avatar_url,
        deleted_storage_key: key || null,
        remaining_count: synced.avatars.length
      }
    });

    queueRemoteJson(c, 'DELETE', `/api/people/${id}/avatars/${avatarId}`, undefined);

    return c.json({
      success: true,
      avatar_id: avatarId,
      avatars: synced.avatars,
      avatar_url: synced.primary?.avatar_url || null
    });
  });

  // Serve avatar images from R2
  app.get('/api/avatars/:key', async (c) => {
    const key = c.req.param('key');
    const object = await c.env.AVATARS.get(key);
    if (!object) {
      return c.json({ error: 'Avatar not found' }, 404);
    }
    let contentType = object.httpMetadata?.contentType || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      contentType = 'application/octet-stream';
    }
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    const origin = c.req.header('Origin') || '';
    const allowedOrigins = (c.env.FRONTEND_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean);
    const allowOrigin = origin && allowedOrigins.includes(origin)
      ? origin
      : (allowedOrigins[0] || '');
    if (allowOrigin) {
      headers.set('Access-Control-Allow-Origin', allowOrigin);
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Vary', 'Origin');
    }
    return new Response(object.body, { headers });
  });

  // Delete a person
  app.delete('/api/people/:id', async (c) => {
    const id = c.req.param('id');
    const layerId = resolveLayerId(c);
    await ensureLayerSchemaSupport(c.env.DB);
    if (!await assertLayerExists(c.env.DB, layerId)) {
      return c.json({ error: 'Layer not found' }, 404);
    }
    const repository = createPeopleRepository(c.env.DB);
    const existing = await repository.getPersonSummaryByIdInLayer(id, layerId);

    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }

    const avatarRows = await loadPersonAvatars(c.env.DB, id);
    for (const avatar of avatarRows) {
      const key = avatar.storage_key || deriveStorageKeyFromUrl(avatar.avatar_url);
      if (!key) continue;
      await c.env.AVATARS.delete(key);
    }

    await repository.deleteCustomFieldsByPersonId(id);

    const result = await repository.deletePersonById(id);

    if (result.changes > 0) {
      notifyUpdate(c, 'people:delete', {
        id,
        name: (existing as any).name ?? null,
        english_name: (existing as any).english_name ?? null
      });
      await recordAuditLog(c, {
        action: 'delete',
        resourceType: 'people',
        resourceId: id,
        summary: `刪除人物 ${(existing as any).name ?? id}`,
        details: {
          name: (existing as any).name ?? null,
          english_name: (existing as any).english_name ?? null,
          removed_avatar_count: avatarRows.length
        }
      });
      queueRemoteJson(c, 'DELETE', `/api/people/${id}`, undefined);
      return c.json({ success: true, id });
    }
    return c.json({ error: 'Person not found' }, 404);
  });
}
