import type { Context } from 'hono';
import type { AppBindings } from './types';

type NotifyDetails = Record<string, unknown>;
type NotifyOptions = {
  photoUrl?: string;
  photoData?: {
    data: ArrayBuffer;
    contentType: string;
    filename: string;
  };
};

const truncate = (value: string, limit = 200) => (
  value.length > limit ? `${value.slice(0, limit - 3)}...` : value
);

const formatValue = (value: unknown) => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return truncate(value.replace(/\s+/g, ' ').trim(), 240);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.length ? truncate(value.map(item => formatValue(item)).join(', '), 240) : '[]';
  }
  try {
    return truncate(JSON.stringify(value), 240);
  } catch {
    return 'unserializable';
  }
};

export const notifyUpdate = (
  c: Context<AppBindings>,
  event: string,
  details?: NotifyDetails,
  options?: NotifyOptions
) => {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  const chatId = c.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('Telegram notify skipped: missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID');
    return;
  }

  const sessionUser = c.get('sessionUser');
  const userLabel = sessionUser ? `${sessionUser.username} (${sessionUser.role})` : 'anonymous';
  const url = new URL(c.req.url);
  const ip = c.req.header('CF-Connecting-IP')
    || c.req.header('X-Forwarded-For')
    || c.req.header('x-forwarded-for')
    || 'unknown';
  const origin = c.req.header('Origin') || c.req.header('origin') || 'unknown';
  const referer = c.req.header('Referer') || c.req.header('referer') || 'unknown';
  const userAgent = c.req.header('User-Agent') || c.req.header('user-agent') || 'unknown';

  const lines: string[] = [
    `Event: ${event}`,
    `Time: ${new Date().toISOString()}`,
    `User: ${userLabel}`,
    `Request: ${c.req.method} ${url.pathname}${url.search}`,
    `IP: ${ip}`,
    `Origin: ${origin}`,
    `Referer: ${referer}`,
    `UA: ${truncate(userAgent, 240)}`
  ];

  if (details && Object.keys(details).length > 0) {
    lines.push('Details:');
    for (const [key, value] of Object.entries(details)) {
      if (value === undefined) continue;
      lines.push(`${key}: ${formatValue(value)}`);
    }
  }

  const text = lines.join('\n');
  const hasPhotoData = Boolean(options?.photoData);
  const hasPhotoUrl = Boolean(options?.photoUrl);
  const endpoint = (hasPhotoData || hasPhotoUrl) ? 'sendPhoto' : 'sendMessage';
  const caption = truncate(text, 900);
  const messageText = truncate(text, 3500);

  let task: Promise<Response>;
  if (hasPhotoData && options?.photoData) {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('caption', caption);
    form.set('photo', new Blob([options.photoData.data], { type: options.photoData.contentType }), options.photoData.filename);
    task = fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: 'POST',
      body: form
    });
  } else if (hasPhotoUrl && options?.photoUrl) {
    const payload = {
      chat_id: chatId,
      photo: options.photoUrl,
      caption
    };
    task = fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } else {
    const payload = {
      chat_id: chatId,
      text: messageText
    };
    task = fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  const wrapped = task.then(async (response) => {
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn('Telegram notify failed:', response.status, body);
    }
    return response;
  }).catch((error) => {
    console.warn('Failed to send Telegram notification:', error);
    return new Response(null, { status: 500 });
  });

  c.executionCtx?.waitUntil(wrapped);
};
