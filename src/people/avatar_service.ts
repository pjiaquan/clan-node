import type { Context } from 'hono';
import type { AppBindings, Env } from '../types';
import { notifyUpdate } from '../notify';
import { queueRemoteFormData } from '../dual_write';
import { recordAuditLog, recordRateLimitAudit } from '../audit';
import { checkAndConsumeRateLimit, getRequestIpAddress } from '../auth';
import { validateAvatarUpload } from '../avatar_validation';
import { PERSON_AVATAR_UPLOAD_RATE_LIMIT } from '../rate_limits';

export type UploadFile = Blob & {
  name?: string;
  size: number;
  type: string;
  stream: () => ReadableStream;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type PersonAvatar = {
  id: string;
  person_id: string;
  avatar_url: string;
  storage_key: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
};

type AvatarUploadOptions = {
  setPrimary?: boolean;
  mirrorPath?: string;
  mirrorSetPrimary?: boolean;
  notifySource?: 'legacy' | 'multi';
};

type HandleAvatarUploadOptions = AvatarUploadOptions & {
  maxAvatarBytes: number;
  ensurePersonExists: (db: Env['DB'], personId: string) => Promise<{ name?: string | null } | null>;
};

const avatarSelectSql = `
  SELECT id, person_id, avatar_url, storage_key, is_primary, sort_order, created_at, updated_at
  FROM person_avatars
`;

export const isUploadFile = (value: unknown): value is UploadFile => (
  Boolean(value)
  && typeof value !== 'string'
  && typeof (value as Blob).arrayBuffer === 'function'
  && typeof (value as Blob).stream === 'function'
);

export const normalizeAvatar = (row: Record<string, unknown>): PersonAvatar => ({
  id: String(row.id),
  person_id: String(row.person_id),
  avatar_url: String(row.avatar_url),
  storage_key: row.storage_key ? String(row.storage_key) : null,
  is_primary: Number(row.is_primary) === 1,
  sort_order: Number(row.sort_order ?? 0),
  created_at: row.created_at ? String(row.created_at) : null,
  updated_at: row.updated_at ? String(row.updated_at) : null,
});

export const deriveStorageKeyFromUrl = (avatarUrl: string | null | undefined) => {
  if (!avatarUrl) return null;
  if (!avatarUrl.startsWith('/api/avatars/')) return null;
  const key = avatarUrl.replace('/api/avatars/', '');
  if (key.includes('/') || key.includes('\\') || key.includes('..')) return null;
  return key;
};

export const loadAvatarMap = async (db: Env['DB']) => {
  const { results } = await db.prepare(
    `${avatarSelectSql} ORDER BY person_id ASC, is_primary DESC, sort_order ASC, created_at ASC`
  ).all();
  const map = new Map<string, PersonAvatar[]>();
  results.forEach((row) => {
    const avatar = normalizeAvatar(row as Record<string, unknown>);
    const list = map.get(avatar.person_id) || [];
    list.push(avatar);
    map.set(avatar.person_id, list);
  });
  return map;
};

export const loadPersonAvatars = async (db: Env['DB'], personId: string) => {
  const { results } = await db.prepare(
    `${avatarSelectSql} WHERE person_id = ? ORDER BY is_primary DESC, sort_order ASC, created_at ASC`
  ).bind(personId).all();
  return results.map((row) => normalizeAvatar(row as Record<string, unknown>));
};

export const resolvePrimaryAvatar = (avatars: PersonAvatar[]) => (
  avatars.find((avatar) => avatar.is_primary) || avatars[0] || null
);

export const syncPrimaryAvatar = async (
  db: Env['DB'],
  personId: string,
  now: string,
  preferredAvatarId?: string,
) => {
  const avatars = await loadPersonAvatars(db, personId);
  if (avatars.length === 0) {
    await db.prepare(
      'UPDATE people SET avatar_url = ?, updated_at = ? WHERE id = ?'
    ).bind(null, now, personId).run();
    return { primary: null as PersonAvatar | null, avatars };
  }

  const preferred = preferredAvatarId
    ? avatars.find((avatar) => avatar.id === preferredAvatarId)
    : null;
  const primary = preferred || resolvePrimaryAvatar(avatars) || avatars[0];

  await db.prepare(
    'UPDATE person_avatars SET is_primary = 0, updated_at = ? WHERE person_id = ? AND is_primary = 1'
  ).bind(now, personId).run();

  await db.prepare(
    'UPDATE person_avatars SET is_primary = 1, updated_at = ? WHERE person_id = ? AND id = ?'
  ).bind(now, personId, primary.id).run();

  const synced = await loadPersonAvatars(db, personId);
  const syncedPrimary = resolvePrimaryAvatar(synced);
  await db.prepare(
    'UPDATE people SET avatar_url = ?, updated_at = ? WHERE id = ?'
  ).bind(syncedPrimary?.avatar_url || null, now, personId).run();

  return {
    primary: syncedPrimary,
    avatars: synced,
  };
};

export const appendAvatar = async (
  db: Env['DB'],
  personId: string,
  avatarUrl: string,
  storageKey: string | null,
  options?: { now?: string; isPrimary?: boolean; sortOrder?: number },
) => {
  const now = options?.now || new Date().toISOString();
  const avatarId = crypto.randomUUID();
  const isPrimary = options?.isPrimary !== false;

  let sortOrder = options?.sortOrder;
  if (sortOrder === undefined) {
    const row = await db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM person_avatars WHERE person_id = ?'
    ).bind(personId).first();
    sortOrder = Number((row as Record<string, unknown> | null)?.max_sort ?? -1) + 1;
  }

  await db.prepare(
    `INSERT INTO person_avatars (
      id, person_id, avatar_url, storage_key, is_primary, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    avatarId,
    personId,
    avatarUrl,
    storageKey,
    0,
    sortOrder,
    now,
    now,
  ).run();

  const synced = await syncPrimaryAvatar(db, personId, now, isPrimary ? avatarId : undefined);
  return {
    avatar: synced.avatars.find((item) => item.id === avatarId) || null,
    primary: synced.primary,
    avatars: synced.avatars,
  };
};

export const ensureAvatarFromLegacy = async (db: Env['DB'], person: { id: string; avatar_url?: string | null }) => {
  const legacyUrl = person.avatar_url as string | null | undefined;
  const personId = person.id;
  let avatars = await loadPersonAvatars(db, personId);
  if (avatars.length > 0 || !legacyUrl) {
    return avatars;
  }

  const now = new Date().toISOString();
  await appendAvatar(
    db,
    personId,
    legacyUrl,
    deriveStorageKeyFromUrl(legacyUrl),
    { now, isPrimary: true, sortOrder: 0 },
  );
  avatars = await loadPersonAvatars(db, personId);
  return avatars;
};

export async function handleAvatarUpload(
  c: Context<AppBindings>,
  personId: string,
  file: UploadFile,
  options: HandleAvatarUploadOptions,
) {
  const sessionUser = c.get('sessionUser');
  if (!sessionUser) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const avatarRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
    action: 'person_avatar_upload',
    limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
    ...PERSON_AVATAR_UPLOAD_RATE_LIMIT,
  });
  if (!avatarRateLimit.allowed) {
    c.header('Retry-After', String(avatarRateLimit.retryAfterSeconds));
    await recordRateLimitAudit(c, {
      action: 'person_avatar_upload',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      route: `/api/people/${personId}/avatars`,
      retryAfterSeconds: avatarRateLimit.retryAfterSeconds,
      summary: `人物頭像上傳速率限制：${personId}`,
    });
    return c.json({ error: 'Too many avatar uploads' }, 429);
  }

  let validated;
  try {
    validated = await validateAvatarUpload(file, options.maxAvatarBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unsupported file type';
    return c.json({ error: message }, message === 'file is too large' ? 413 : 400);
  }

  const existing = await options.ensurePersonExists(c.env.DB, personId);
  if (!existing) {
    return c.json({ error: 'Person not found' }, 404);
  }

  const now = new Date().toISOString();
  const key = `person-${personId}-${Date.now()}-${crypto.randomUUID()}.${validated.extension}`;
  await c.env.AVATARS.put(key, validated.bytes, {
    httpMetadata: { contentType: validated.contentType },
  });

  const avatarUrl = `/api/avatars/${key}`;
  const created = await appendAvatar(
    c.env.DB,
    personId,
    avatarUrl,
    key,
    {
      now,
      isPrimary: options.setPrimary !== false,
    },
  );

  const avatarLink = new URL(avatarUrl, c.req.url).toString();
  notifyUpdate(c, 'people:avatar', {
    id: personId,
    name: existing.name ?? null,
    avatar_url: created.primary?.avatar_url ?? avatarUrl,
    avatar_id: created.avatar?.id ?? null,
    avatar_count: created.avatars.length,
    source: options.notifySource || 'multi',
  }, { photoUrl: avatarLink });

  await recordAuditLog(c, {
    action: 'update_avatar',
    resourceType: 'people',
    resourceId: personId,
    summary: `更新人物頭像 ${String(existing.name ?? personId)}`,
    details: {
      avatar_url: avatarUrl,
      avatar_id: created.avatar?.id ?? null,
      set_primary: options.setPrimary !== false,
      avatar_count: created.avatars.length,
    },
  });

  const mirrorForm = new FormData();
  mirrorForm.set('file', new Blob([validated.buffer], { type: validated.contentType }), file.name || 'avatar');
  if (options.mirrorSetPrimary !== undefined) {
    mirrorForm.set('set_primary', options.mirrorSetPrimary ? '1' : '0');
  }
  queueRemoteFormData(c, options.mirrorPath || `/api/people/${personId}/avatars`, mirrorForm);

  return c.json({
    avatar: created.avatar,
    avatars: created.avatars,
    avatar_url: created.primary?.avatar_url || null,
  });
}
