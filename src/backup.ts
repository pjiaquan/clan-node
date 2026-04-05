import type { Context, Hono } from 'hono';
import type { AppBindings } from './types';
import { createBackupRepository } from './d1_repositories';
import { recordAuditLog, recordRateLimitAudit } from './audit';
import { queueRemoteJson } from './dual_write';
import { checkAndConsumeRateLimit, getRequestIpAddress } from './auth';
import { BACKUP_EXPORT_RATE_LIMIT, BACKUP_IMPORT_RATE_LIMIT } from './rate_limits';
import {
  decryptCustomFieldRows,
  decryptPersonRow,
  encryptProtectedValue,
  migratePlaintextCustomFieldRows,
  migratePlaintextPersonRow,
  protectPersonWriteFields
} from './data_protection';
import { DEFAULT_LAYER_ID, DEFAULT_LAYER_NAME, ensureLayerSchemaSupport } from './layers';
import { getPeopleSchemaSupport } from './schema';
import {
  BACKUP_VERSION,
  IMPORT_CONFIRMATION_TEXT,
  buildLegacyDefaultLayer,
  buildExportPayload,
  extractDataEnvelope,
  isRecord,
  parseAvatars,
  parseCustomFields,
  parseKinshipLabels,
  parseLayers,
  parsePeople,
  parseRelationshipTypeLabels,
  parseRelationships,
  requireArrayField,
  validateRelations,
} from './backup/service';

const ensureAdmin = (c: Context<AppBindings>) => {
  const sessionUser = c.get('sessionUser');
  if (!sessionUser || sessionUser.role !== 'admin') {
    return false;
  }
  return true;
};


export function registerBackupRoutes(app: Hono<AppBindings>) {
  app.get('/api/admin/backup/export', async (c) => {
    if (!ensureAdmin(c)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const exportRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'backup_export',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...BACKUP_EXPORT_RATE_LIMIT
    });
    if (!exportRateLimit.allowed) {
      c.header('Retry-After', String(exportRateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'backup_export',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: '/api/admin/backup/export',
        retryAfterSeconds: exportRateLimit.retryAfterSeconds,
        summary: `備份匯出速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many backup export requests' }, 429);
    }

    await ensureLayerSchemaSupport(c.env.DB);
    const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
    const repository = createBackupRepository(c.env.DB);
    const exported = await repository.exportAll(peopleSchema.hasEmail);
    await Promise.all(exported.people.map((row) => migratePlaintextPersonRow(c.env.DB, c.env, row)));
    await migratePlaintextCustomFieldRows(c.env.DB, c.env, exported.customFields);
    const decryptedPeople = await Promise.all(exported.people.map((row) => decryptPersonRow(c.env, row)));
    const decryptedCustomFields = await decryptCustomFieldRows(c.env, exported.customFields);

    const payload = buildExportPayload(
      sessionUser?.username || null,
      exported.layers,
      decryptedPeople as Array<Record<string, unknown>>,
      exported.avatars,
      exported.relationships,
      decryptedCustomFields as Array<Record<string, unknown>>,
      exported.relationshipTypeLabels,
      exported.kinshipLabels,
    );

    await recordAuditLog(c, {
      action: 'export_backup',
      resourceType: 'graph',
      summary: `匯出節點備份（${payload.people.length} 節點）`,
      details: {
          people: payload.people.length,
          layers: payload.layers.length,
          avatars: payload.person_avatars.length,
        relationships: payload.relationships.length,
        custom_fields: payload.person_custom_fields.length,
      }
    });

    return c.json(payload);
  });

  app.post('/api/admin/backup/import', async (c) => {
    if (!ensureAdmin(c)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const importRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'backup_import',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...BACKUP_IMPORT_RATE_LIMIT
    });
    if (!importRateLimit.allowed) {
      c.header('Retry-After', String(importRateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'backup_import',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: '/api/admin/backup/import',
        retryAfterSeconds: importRateLimit.retryAfterSeconds,
        summary: `備份匯入速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many backup import requests' }, 429);
    }

    try {
      const contentLengthHeader = c.req.header('content-length');
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (Number.isFinite(contentLength) && contentLength > 50 * 1024 * 1024) {
          return c.json({ error: 'Payload too large. Maximum size is 50MB.' }, 413);
        }
      }

      const body = await c.req.json();
      if (!isRecord(body) || body.confirmation_text !== IMPORT_CONFIRMATION_TEXT) {
        return c.json({ error: `confirmation_text must equal ${IMPORT_CONFIRMATION_TEXT}` }, 400);
      }
      const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
      const repository = createBackupRepository(c.env.DB);
      const source = extractDataEnvelope(body);
      const now = new Date().toISOString();
      await ensureLayerSchemaSupport(c.env.DB);

      const layers = Array.isArray(source.layers)
        ? parseLayers(source.layers as unknown[], now)
        : [buildLegacyDefaultLayer(now)];
      const people = parsePeople(requireArrayField(source, 'people'), now);
      const avatars = parseAvatars(requireArrayField(source, 'person_avatars'), now);
      const relationships = parseRelationships(requireArrayField(source, 'relationships'), now);
      const customFields = parseCustomFields(requireArrayField(source, 'person_custom_fields'), now);
      const hasRelationshipTypeLabels = Array.isArray(source.relationship_type_labels);
      const hasKinshipLabels = Array.isArray(source.kinship_labels);
      const relationshipTypeLabels = hasRelationshipTypeLabels
        ? parseRelationshipTypeLabels(source.relationship_type_labels as unknown[], now)
        : [];
      const kinshipLabels = hasKinshipLabels
        ? parseKinshipLabels(source.kinship_labels as unknown[], now)
        : [];

      validateRelations(layers, people, avatars, relationships, customFields);

      // Pre-encrypt custom fields so we can batch them
      const encryptedCustomFields = await Promise.all(
        customFields.map(async (field) => ({
          ...field,
          encryptedValue: await encryptProtectedValue(c.env, field.value)
        }))
      );

      // Pre-compute primary avatars
      const avatarPersonIds = [...new Set(avatars.map((avatar) => avatar.person_id))];
      const primaryAvatars = new Map<string, string | null>();
      for (const personId of avatarPersonIds) {
        const personAvatars = avatars.filter(a => a.person_id === personId);
        personAvatars.sort((a, b) => {
          if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
        primaryAvatars.set(personId, personAvatars[0]?.avatar_url ?? null);
      }

      // Pre-protect people fields
      const protectedPeople = await Promise.all(
        people.map(async (person) => {
          const protectedFields = await protectPersonWriteFields(c.env, {
            blood_type: person.blood_type,
            dob: person.dob,
            dod: person.dod,
            tob: person.tob,
            tod: person.tod,
            metadata: person.metadata
          });
          return { person, protectedFields };
        })
      );

      await repository.runImportBatch({
        includeEmail: peopleSchema.hasEmail,
        layers,
        people: protectedPeople,
        avatars,
        encryptedCustomFields: encryptedCustomFields.map((field) => ({
          ...field,
          encryptedValue: field.encryptedValue || '',
        })),
        relationships,
        relationshipTypeLabels,
        kinshipLabels,
        primaryAvatars,
        hasRelationshipTypeLabels,
        hasKinshipLabels,
      });


      await recordAuditLog(c, {
        action: 'import_backup',
        resourceType: 'graph',
        summary: `匯入節點備份（${people.length} 節點）`,
        details: {
          people: people.length,
          layers: layers.length,
          avatars: avatars.length,
          relationships: relationships.length,
          custom_fields: customFields.length,
          relationship_type_labels: relationshipTypeLabels.length,
          kinship_labels: kinshipLabels.length,
        }
      });

      queueRemoteJson(c, 'POST', '/api/admin/backup/import', body);

      return c.json({
        success: true,
        version: BACKUP_VERSION,
        counts: {
          people: people.length,
          layers: layers.length,
          avatars: avatars.length,
          relationships: relationships.length,
          custom_fields: customFields.length,
          relationship_type_labels: relationshipTypeLabels.length,
          kinship_labels: kinshipLabels.length,
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed';
      return c.json({ error: message }, 400);
    }
  });
}
