import type { Hono } from 'hono';
import type { AppBindings } from './types';
import { checkAndConsumeRateLimit, getRequestIpAddress } from './auth';
import { notifyUpdate } from './notify';
import { recordAuditLog, recordRateLimitAudit } from './audit';
import { readJsonObjectBody } from './http';
import { KINSHIP_LABEL_WRITE_RATE_LIMIT } from './rate_limits';

export type KinshipLabelResolved = {
  title: string;
  formalTitle: string;
};

type KinshipLabelRow = {
  default_title: string;
  default_formal_title: string;
  custom_title: string | null;
  custom_formal_title: string | null;
  description: string;
  created_at: string | null;
  updated_at: string | null;
};

type KinshipLabelDefault = {
  default_title: string;
  default_formal_title: string;
  description: string;
};

const KEY_SEPARATOR = '\u0001';

const CORE_KINSHIP_DEFAULTS: readonly KinshipLabelDefault[] = [
  { default_title: '我', default_formal_title: '我', description: '自己' },
  { default_title: '父親', default_formal_title: '父親', description: '爸爸' },
  { default_title: '母親', default_formal_title: '母親', description: '媽媽' },
  { default_title: '爺爺', default_formal_title: '爺爺', description: '父系祖父' },
  { default_title: '奶奶', default_formal_title: '奶奶', description: '父系祖母' },
  { default_title: '外公', default_formal_title: '外公', description: '母系祖父' },
  { default_title: '外婆', default_formal_title: '外婆', description: '母系祖母' },
  { default_title: '丈夫', default_formal_title: '丈夫', description: '男性配偶稱呼' },
  { default_title: '妻子', default_formal_title: '妻子', description: '女性配偶稱呼' },
  { default_title: '前夫', default_formal_title: '前夫', description: '過往婚姻男性配偶' },
  { default_title: '前妻', default_formal_title: '前妻', description: '過往婚姻女性配偶' },
  { default_title: '哥哥', default_formal_title: '哥哥', description: '男性年長手足' },
  { default_title: '弟弟', default_formal_title: '弟弟', description: '男性年幼手足' },
  { default_title: '姐姐', default_formal_title: '姐姐', description: '女性年長手足' },
  { default_title: '妹妹', default_formal_title: '妹妹', description: '女性年幼手足' },
  { default_title: '伯父', default_formal_title: '伯父', description: '父親年長兄弟' },
  { default_title: '叔叔', default_formal_title: '叔叔', description: '父親年幼兄弟' },
  { default_title: '姑姑', default_formal_title: '姑姑', description: '父親姊妹' },
  { default_title: '舅舅', default_formal_title: '舅舅', description: '母親兄弟' },
  { default_title: '阿姨', default_formal_title: '阿姨', description: '母親姊妹' },
  { default_title: '伯母', default_formal_title: '伯母', description: '伯父配偶' },
  { default_title: '嬸嬸', default_formal_title: '嬸嬸', description: '叔叔配偶' },
  { default_title: '姑丈', default_formal_title: '姑丈', description: '姑姑配偶' },
  { default_title: '舅媽', default_formal_title: '舅媽', description: '舅舅配偶' },
  { default_title: '姨丈', default_formal_title: '姨丈', description: '阿姨配偶' },
  { default_title: '兒子', default_formal_title: '兒子', description: '男性子女' },
  { default_title: '女兒', default_formal_title: '女兒', description: '女性子女' },
  { default_title: '媳婦', default_formal_title: '媳婦', description: '兒子配偶' },
  { default_title: '女婿', default_formal_title: '女婿', description: '女兒配偶' },
  { default_title: '孫子', default_formal_title: '孫子', description: '子女的男性子女' },
  { default_title: '孫女', default_formal_title: '孫女', description: '子女的女性子女' },
  { default_title: '外孫', default_formal_title: '外孫', description: '外家第三代男性' },
  { default_title: '外孫女', default_formal_title: '外孫女', description: '外家第三代女性' },
] as const;

const normalizeText = (value: unknown) => (
  typeof value === 'string' ? value.trim() : ''
);

const makeKey = (defaultTitle: string, defaultFormalTitle: string) => (
  `${defaultTitle}${KEY_SEPARATOR}${defaultFormalTitle}`
);

export async function ensureKinshipLabelsTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS kinship_labels (
      default_title TEXT NOT NULL,
      default_formal_title TEXT NOT NULL,
      custom_title TEXT,
      custom_formal_title TEXT,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (default_title, default_formal_title)
    )
  `).run();

  for (const item of CORE_KINSHIP_DEFAULTS) {
    await db.prepare(`
      INSERT OR IGNORE INTO kinship_labels (
        default_title, default_formal_title,
        custom_title, custom_formal_title,
        description, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, ?, datetime('now'), datetime('now'))
    `).bind(item.default_title, item.default_formal_title, item.description).run();
  }
}

const mapRow = (row: any): KinshipLabelRow | null => {
  const defaultTitle = normalizeText(row?.default_title);
  const defaultFormalTitle = normalizeText(row?.default_formal_title);
  if (!defaultTitle || !defaultFormalTitle) return null;
  const customTitle = normalizeText(row?.custom_title);
  const customFormalTitle = normalizeText(row?.custom_formal_title);
  return {
    default_title: defaultTitle,
    default_formal_title: defaultFormalTitle,
    custom_title: customTitle || null,
    custom_formal_title: customFormalTitle || null,
    description: normalizeText(row?.description),
    created_at: typeof row?.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row?.updated_at === 'string' ? row.updated_at : null,
  };
};

export async function listKinshipLabels(db: D1Database): Promise<KinshipLabelRow[]> {
  await ensureKinshipLabelsTable(db);
  const { results } = await db.prepare(`
    SELECT
      default_title, default_formal_title,
      custom_title, custom_formal_title,
      description, created_at, updated_at
    FROM kinship_labels
    ORDER BY default_title COLLATE NOCASE ASC, default_formal_title COLLATE NOCASE ASC
  `).all();

  return results
    .map((row) => mapRow(row))
    .filter((row): row is KinshipLabelRow => row !== null);
}

export async function loadKinshipLabelMap(db: D1Database) {
  const rows = await listKinshipLabels(db);
  const map = new Map<string, KinshipLabelRow>();
  rows.forEach((row) => {
    map.set(makeKey(row.default_title, row.default_formal_title), row);
  });
  return map;
}

export function resolveKinshipLabel(
  map: Map<string, KinshipLabelRow>,
  defaultTitle: string,
  defaultFormalTitle: string
): KinshipLabelResolved {
  const row = map.get(makeKey(defaultTitle, defaultFormalTitle));
  if (!row) {
    return {
      title: defaultTitle,
      formalTitle: defaultFormalTitle,
    };
  }
  return {
    title: row.custom_title || row.default_title,
    formalTitle: row.custom_formal_title || row.default_formal_title,
  };
}

export async function trackKinshipLabelDefaults(
  db: D1Database,
  rows: Array<{ default_title: string; default_formal_title: string }>
) {
  if (!rows.length) return;
  await ensureKinshipLabelsTable(db);

  const now = new Date().toISOString();
  const seen = new Set<string>();
  for (const row of rows) {
    const defaultTitle = normalizeText(row.default_title);
    const defaultFormalTitle = normalizeText(row.default_formal_title);
    if (!defaultTitle || !defaultFormalTitle) continue;
    const key = makeKey(defaultTitle, defaultFormalTitle);
    if (seen.has(key)) continue;
    seen.add(key);
    await db.prepare(`
      INSERT OR IGNORE INTO kinship_labels (
        default_title, default_formal_title,
        custom_title, custom_formal_title,
        description, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, '', ?, ?)
    `).bind(defaultTitle, defaultFormalTitle, now, now).run();
  }
}

export function registerKinshipLabelRoutes(app: Hono<AppBindings>) {
  app.get('/api/kinship-labels', async (c) => {
    const items = await listKinshipLabels(c.env.DB);
    return c.json(items);
  });

  app.put('/api/kinship-labels', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const rateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'kinship_label_write',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...KINSHIP_LABEL_WRITE_RATE_LIMIT
    });
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'kinship_label_write',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: '/api/kinship-labels',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        summary: `稱呼表寫入速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many kinship label write requests' }, 429);
    }
    await ensureKinshipLabelsTable(c.env.DB);
    const body = await readJsonObjectBody(c.req);
    const defaultTitle = normalizeText((body as any).default_title);
    const defaultFormalTitle = normalizeText((body as any).default_formal_title);
    if (!defaultTitle || !defaultFormalTitle) {
      return c.json({ error: 'default_title and default_formal_title are required' }, 400);
    }

    const hasCustomTitle = Object.prototype.hasOwnProperty.call(body, 'custom_title');
    const hasCustomFormalTitle = Object.prototype.hasOwnProperty.call(body, 'custom_formal_title');
    const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
    if (!hasCustomTitle && !hasCustomFormalTitle && !hasDescription) {
      return c.json({ error: 'No updates provided' }, 400);
    }

    const customTitleRaw = hasCustomTitle ? normalizeText((body as any).custom_title) : undefined;
    const customFormalTitleRaw = hasCustomFormalTitle ? normalizeText((body as any).custom_formal_title) : undefined;
    const description = hasDescription ? normalizeText((body as any).description) : undefined;

    if (customTitleRaw !== undefined && customTitleRaw.length > 24) {
      return c.json({ error: 'custom_title is too long (max 24 chars)' }, 400);
    }
    if (customFormalTitleRaw !== undefined && customFormalTitleRaw.length > 24) {
      return c.json({ error: 'custom_formal_title is too long (max 24 chars)' }, 400);
    }
    if (description !== undefined && description.length > 120) {
      return c.json({ error: 'description is too long (max 120 chars)' }, 400);
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(`
      INSERT OR IGNORE INTO kinship_labels (
        default_title, default_formal_title,
        custom_title, custom_formal_title,
        description, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, '', ?, ?)
    `).bind(defaultTitle, defaultFormalTitle, now, now).run();

    const existing = await c.env.DB.prepare(`
      SELECT custom_title, custom_formal_title, description
      FROM kinship_labels
      WHERE default_title = ? AND default_formal_title = ?
    `).bind(defaultTitle, defaultFormalTitle).first();

    const nextCustomTitle = customTitleRaw !== undefined
      ? (customTitleRaw || null)
      : (normalizeText((existing as any)?.custom_title) || null);
    const nextCustomFormalTitle = customFormalTitleRaw !== undefined
      ? (customFormalTitleRaw || null)
      : (normalizeText((existing as any)?.custom_formal_title) || null);
    const nextDescription = description !== undefined
      ? description
      : normalizeText((existing as any)?.description);

    await c.env.DB.prepare(`
      UPDATE kinship_labels
      SET custom_title = ?, custom_formal_title = ?, description = ?, updated_at = ?
      WHERE default_title = ? AND default_formal_title = ?
    `).bind(
      nextCustomTitle,
      nextCustomFormalTitle,
      nextDescription,
      now,
      defaultTitle,
      defaultFormalTitle
    ).run();

    const updated = await c.env.DB.prepare(`
      SELECT
        default_title, default_formal_title,
        custom_title, custom_formal_title,
        description, created_at, updated_at
      FROM kinship_labels
      WHERE default_title = ? AND default_formal_title = ?
    `).bind(defaultTitle, defaultFormalTitle).first();

    const mapped = mapRow(updated);
    if (!mapped) {
      return c.json({ error: 'Failed to load updated kinship label' }, 500);
    }

    notifyUpdate(c, 'kinship_labels:update', {
      default_title: mapped.default_title,
      default_formal_title: mapped.default_formal_title,
      custom_title: mapped.custom_title,
      custom_formal_title: mapped.custom_formal_title,
    });
    await recordAuditLog(c, {
      action: 'update',
      resourceType: 'kinship_labels',
      resourceId: `${mapped.default_title} | ${mapped.default_formal_title}`,
      summary: `更新稱呼 ${mapped.default_title}`,
      details: {
        default_title: mapped.default_title,
        default_formal_title: mapped.default_formal_title,
        custom_title: mapped.custom_title,
        custom_formal_title: mapped.custom_formal_title,
        description: mapped.description,
      }
    });

    return c.json(mapped);
  });

  app.post('/api/kinship-labels/reset', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const rateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'kinship_label_write',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...KINSHIP_LABEL_WRITE_RATE_LIMIT
    });
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'kinship_label_write',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: '/api/kinship-labels/reset',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        summary: `稱呼表重設速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many kinship label write requests' }, 429);
    }
    await ensureKinshipLabelsTable(c.env.DB);
    const now = new Date().toISOString();
    await c.env.DB.prepare(`
      UPDATE kinship_labels
      SET custom_title = NULL, custom_formal_title = NULL, updated_at = ?
    `).bind(now).run();

    const items = await listKinshipLabels(c.env.DB);
    notifyUpdate(c, 'kinship_labels:reset', {
      count: items.length
    });
    await recordAuditLog(c, {
      action: 'reset',
      resourceType: 'kinship_labels',
      resourceId: null,
      summary: '重設全部稱呼為預設值',
      details: {
        count: items.length
      }
    });

    return c.json({ items });
  });
}
