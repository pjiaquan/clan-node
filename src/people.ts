import type { Hono } from 'hono';
import type { AppBindings, Env } from './types';
import { safeParse } from './utils';
import { notifyUpdate } from './notify';
import { queueRemoteFormData, queueRemoteJson } from './dual_write';

async function updateSiblingOrdering(db: D1Database, personId: string) {
  const person = await db.prepare(
    'SELECT id, dob FROM people WHERE id = ?'
  ).bind(personId).first();

  const personDob = person && (person as any).dob ? new Date((person as any).dob).getTime() : 0;
  if (!personDob) return;

  const { results } = await db.prepare(
    "SELECT id, from_person_id, to_person_id FROM relationships WHERE type = 'sibling' AND (from_person_id = ? OR to_person_id = ?)"
  ).bind(personId, personId).all();

  for (const rel of results) {
    const relAny = rel as any;
    const otherId = relAny.from_person_id === personId ? relAny.to_person_id : relAny.from_person_id;
    const other = await db.prepare(
      'SELECT id, dob FROM people WHERE id = ?'
    ).bind(otherId).first();
    const otherDob = other && (other as any).dob ? new Date((other as any).dob).getTime() : 0;
    if (!otherDob || otherDob === personDob) continue;

    const olderId = personDob < otherDob ? personId : otherId;
    const youngerId = olderId === personId ? otherId : personId;
    const metadata = JSON.stringify({ sourceHandle: 'right-s', targetHandle: 'left-t' });

    await db.prepare(
      'UPDATE relationships SET from_person_id = ?, to_person_id = ?, metadata = ? WHERE id = ?'
    ).bind(olderId, youngerId, metadata, relAny.id).run();
  }
}

export function registerPeopleRoutes(app: Hono<AppBindings>) {
  const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
  const ALLOWED_AVATAR_TYPES: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };

  const loadCustomFields = async (db: Env['DB']) => {
    const { results } = await db.prepare(
      'SELECT person_id, label, value FROM person_custom_fields'
    ).all();
    const map = new Map<string, { label: string; value: string }[]>();
    results.forEach((row: any) => {
      const list = map.get(row.person_id) || [];
      list.push({ label: row.label, value: row.value });
      map.set(row.person_id, list);
    });
    return map;
  };

  const loadPersonCustomFields = async (db: Env['DB'], personId: string) => {
    const { results } = await db.prepare(
      'SELECT label, value FROM person_custom_fields WHERE person_id = ? ORDER BY id'
    ).bind(personId).all();
    return results.map((row: any) => ({ label: row.label, value: row.value }));
  };

  const extractCustomFields = (body: any, metadata: any) => {
    if (Array.isArray(body?.custom_fields)) return body.custom_fields;
    if (Array.isArray(metadata?.customFields)) return metadata.customFields;
    return null;
  };

  // Get all people
  app.get('/api/people', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT id, name, english_name, gender, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people ORDER BY created_at'
    ).all();
    const customFieldsMap = await loadCustomFields(c.env.DB);

    const parsedResults = results.map(person => ({
      ...person,
      metadata: {
        ...safeParse(person.metadata as string),
        customFields: customFieldsMap.get((person as any).id) || []
      }
    }));

    return c.json(parsedResults);
  });

  // Get a single person by ID
  app.get('/api/people/:id', async (c) => {
    const id = c.req.param('id');
    const person = await c.env.DB.prepare(
      'SELECT id, name, english_name, gender, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people WHERE id = ?'
    ).bind(id).first();

    if (!person) {
      return c.json({ error: 'Person not found' }, 404);
    }
    const customFields = await loadPersonCustomFields(c.env.DB, id);
    return c.json({
      ...person,
      metadata: {
        ...safeParse((person as any).metadata as string),
        customFields
      }
    });
  });

  // Create a new person
  app.post('/api/people', async (c) => {
    const body = await c.req.json();
    const { id: providedId, name, english_name, gender, dob, dod, tob, tod, avatar_url, metadata } = body;

    if (!name) {
      return c.json({ error: 'Name is required' }, 400);
    }

    const id = providedId || crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      'INSERT INTO people (id, name, english_name, gender, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id,
      name,
      english_name || null,
      gender || 'O',
      dob || null,
      dod || null,
      tob || null,
      tod || null,
      avatar_url || null,
      metadata ? JSON.stringify(metadata) : null,
      now,
      now
    ).run();

    const customFields = extractCustomFields(body, metadata);
    if (customFields) {
      for (const field of customFields) {
        if (!field?.label && !field?.value) continue;
        await c.env.DB.prepare(
          'INSERT INTO person_custom_fields (person_id, label, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(
          id,
          field.label || '',
          field.value || '',
          now,
          now
        ).run();
      }
    }

    const person = await c.env.DB.prepare(
      'SELECT id, name, english_name, gender, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people WHERE id = ?'
    ).bind(id).first();

    const customFieldsResult = await loadPersonCustomFields(c.env.DB, id);
    const metadataKeys = metadata && typeof metadata === 'object'
      ? Object.keys(metadata as Record<string, unknown>)
      : [];
    const customFieldsCount = Array.isArray(customFields) ? customFields.length : 0;
    const customFieldsSummary = Array.isArray(customFields)
      ? customFields.map(field => ({
        label: field?.label || '',
        value: field?.value || ''
      }))
      : [];
    const avatarLink = avatar_url ? new URL(avatar_url, c.req.url).toString() : undefined;
    notifyUpdate(c, 'people:create', {
      id,
      name,
      english_name,
      gender,
      dob,
      dod,
      tob,
      tod,
      avatar_url,
      metadata_keys: metadataKeys,
      custom_fields_count: customFieldsCount,
      custom_fields: customFieldsSummary
    }, avatarLink ? { photoUrl: avatarLink } : undefined);

    const mirrorPayload: Record<string, unknown> = {
      id,
      name,
      english_name: english_name || null,
      gender: gender || 'O',
      dob: dob || null,
      dod: dod || null,
      tob: tob || null,
      tod: tod || null,
      avatar_url: avatar_url || null,
      metadata: metadata || null
    };
    if (customFields) {
      mirrorPayload.custom_fields = customFields;
    }
    queueRemoteJson(c, 'POST', '/api/people', mirrorPayload);

    return c.json({
      ...person,
      metadata: {
        ...safeParse((person as any).metadata as string),
        customFields: customFieldsResult
      }
    }, 201);
  });

  // Update a person
  app.put('/api/people/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { name, english_name, gender, dob, dod, tob, tod, avatar_url, metadata } = body;

    const existing = await c.env.DB.prepare(
      'SELECT id, name, english_name, gender, dob, dod, tob, tod, avatar_url, metadata FROM people WHERE id = ?'
    ).bind(id).first();

    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }
    const existingAny = existing as any;
    const previousDob = existingAny.dob as string | null;
    const existingCustomFields = await loadPersonCustomFields(c.env.DB, id);

    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: unknown[] = [];
    const changedFields: string[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
      changedFields.push('name');
    }
    if (english_name !== undefined) {
      updates.push('english_name = ?');
      values.push(english_name);
      changedFields.push('english_name');
    }
    if (gender !== undefined) {
      updates.push('gender = ?');
      values.push(gender);
      changedFields.push('gender');
    }
    if (dob !== undefined) {
      updates.push('dob = ?');
      values.push(dob);
      changedFields.push('dob');
    }
    if (dod !== undefined) {
      updates.push('dod = ?');
      values.push(dod);
      changedFields.push('dod');
    }
    if (tob !== undefined) {
      updates.push('tob = ?');
      values.push(tob);
      changedFields.push('tob');
    }
    if (tod !== undefined) {
      updates.push('tod = ?');
      values.push(tod);
      changedFields.push('tod');
    }
    if (avatar_url !== undefined) {
      updates.push('avatar_url = ?');
      values.push(avatar_url);
      changedFields.push('avatar_url');
    }
    if (metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(metadata));
      changedFields.push('metadata');
    }

    const customFields = extractCustomFields(body, metadata);

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(now);
      values.push(id);

      await c.env.DB.prepare(
        `UPDATE people SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...values).run();
    } else if (customFields !== null) {
      await c.env.DB.prepare(
        'UPDATE people SET updated_at = ? WHERE id = ?'
      ).bind(now, id).run();
    } else {
      return c.json({ error: 'No fields to update' }, 400);
    }

    if (customFields !== null) {
      await c.env.DB.prepare(
        'DELETE FROM person_custom_fields WHERE person_id = ?'
      ).bind(id).run();
      for (const field of customFields) {
        if (!field?.label && !field?.value) continue;
        await c.env.DB.prepare(
          'INSERT INTO person_custom_fields (person_id, label, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(
          id,
          field.label || '',
          field.value || '',
          now,
          now
        ).run();
      }
    }

    if (dob !== undefined && dob !== previousDob) {
      await updateSiblingOrdering(c.env.DB, id);
    }

    const person = await c.env.DB.prepare(
      'SELECT id, name, english_name, gender, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people WHERE id = ?'
    ).bind(id).first();

    const customFieldsResult = await loadPersonCustomFields(c.env.DB, id);
    const formatCustomFields = (fields: { label: string; value: string }[]) => (
      fields.map((field) => ({
        label: field.label || '',
        value: field.value || ''
      }))
    );

    const updateDetails: Record<string, unknown> = {
      id,
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
    if (gender !== undefined) updateDetails.gender = gender;
    if (dob !== undefined) updateDetails.dob = dob;
    if (dod !== undefined) updateDetails.dod = dod;
    if (tob !== undefined) updateDetails.tob = tob;
    if (tod !== undefined) updateDetails.tod = tod;
    let avatarLink: string | undefined;
    if (avatar_url !== undefined) {
      const prevAvatar = existingAny.avatar_url ?? null;
      updateDetails.avatar_url = {
        old: prevAvatar,
        new: avatar_url
      };
      if (avatar_url) {
        avatarLink = new URL(avatar_url, c.req.url).toString();
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
          old: previousFields,
          new: formattedNext
        };
        updateDetails.custom_fields_count = formattedNext.length;
      }
    }
    notifyUpdate(c, 'people:update', updateDetails, avatarLink ? { photoUrl: avatarLink } : undefined);
    queueRemoteJson(c, 'PUT', `/api/people/${id}`, body);
    return c.json({
      ...person,
      metadata: {
        ...safeParse((person as any).metadata as string),
        customFields: customFieldsResult
      }
    });
  });

  // Upload avatar for a person
  app.post('/api/people/:id/avatar', async (c) => {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      'SELECT avatar_url FROM people WHERE id = ?'
    ).bind(id).first();

    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }

    try {
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) {
        return c.json({ error: 'file is required' }, 400);
      }
      if (file.size > MAX_AVATAR_BYTES) {
        return c.json({ error: 'file is too large' }, 413);
      }

      if (!file.type || !file.type.startsWith('image/')) {
        return c.json({ error: 'unsupported file type' }, 400);
      }

      const ext = ALLOWED_AVATAR_TYPES[file.type];
      if (!ext) {
        return c.json({ error: 'unsupported file type' }, 400);
      }

      const prevUrl = (existing as any).avatar_url as string | null;
      if (prevUrl && prevUrl.startsWith('/api/avatars/')) {
        const prevKey = prevUrl.replace('/api/avatars/', '');
        await c.env.AVATARS.delete(prevKey);
      }

      const key = `person-${id}-${Date.now()}.${ext}`;
      await c.env.AVATARS.put(key, file.stream(), {
        httpMetadata: { contentType: file.type }
      });

      const avatarUrl = `/api/avatars/${key}`;
      await c.env.DB.prepare(
        'UPDATE people SET avatar_url = ?, updated_at = ? WHERE id = ?'
      ).bind(avatarUrl, new Date().toISOString(), id).run();

      const avatarLink = new URL(avatarUrl, c.req.url).toString();
      notifyUpdate(c, 'people:avatar', {
        id,
        avatar_url: avatarUrl
      }, { photoUrl: avatarLink });
      const avatarBuffer = await file.arrayBuffer();
      const mirrorForm = new FormData();
      mirrorForm.set('file', new Blob([avatarBuffer], { type: file.type || 'application/octet-stream' }), file.name || 'avatar');
      queueRemoteFormData(c, `/api/people/${id}/avatar`, mirrorForm);
      return c.json({ avatar_url: avatarUrl });
    } catch (error) {
      console.error('Avatar upload failed:', error);
      return c.json({ error: 'Avatar upload failed' }, 500);
    }
  });

  // Serve avatar images from R2
  app.get('/api/avatars/:key', async (c) => {
    const key = c.req.param('key');
    const object = await c.env.AVATARS.get(key);
    if (!object) {
      return c.json({ error: 'Avatar not found' }, 404);
    }
    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
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

    await c.env.DB.prepare(
      'DELETE FROM person_custom_fields WHERE person_id = ?'
    ).bind(id).run();

    const result = await c.env.DB.prepare(
      'DELETE FROM people WHERE id = ?'
    ).bind(id).run();

    if (result.success && (result.meta.changes ?? 0) > 0) {
      notifyUpdate(c, 'people:delete', { id });
      queueRemoteJson(c, 'DELETE', `/api/people/${id}`, undefined);
      return c.json({ success: true, id });
    }
    return c.json({ error: 'Person not found' }, 404);
  });
}
