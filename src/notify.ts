import type { Context } from 'hono';
import type { AppBindings, Env } from './types';

type NotifyDetails = Record<string, unknown>;
type NotifyOptions = {
  photoUrl?: string;
  photoData?: {
    data: ArrayBuffer;
    contentType: string;
    filename: string;
  };
};

type NotifyPayload = {
  text: string;
  caption: string;
  photoUrl?: string;
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

export const sendTelegramPayload = async (env: Env, payload: NotifyPayload) => {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('Telegram notify skipped: missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID');
    return;
  }

  const endpoint = payload.photoUrl ? 'sendPhoto' : 'sendMessage';
  const body = payload.photoUrl
    ? {
      chat_id: chatId,
      photo: payload.photoUrl,
      caption: payload.caption
    }
    : {
      chat_id: chatId,
      text: payload.text
    };

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      console.warn('Telegram notify failed:', response.status, responseBody);
    }
  } catch (error) {
    console.warn('Failed to send Telegram notification:', error);
  }
};

export const notifyUpdate = (
  c: Context<AppBindings>,
  event: string,
  details?: NotifyDetails,
  options?: NotifyOptions
) => {
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

  const snapshot = {
    event,
    details,
    photoUrl: options?.photoUrl,
    userLabel,
    request: {
      method: c.req.method,
      path: `${url.pathname}${url.search}`,
      ip,
      origin,
      referer,
      userAgent
    }
  };

  c.executionCtx?.waitUntil((async () => {
    const lines: string[] = [
      `Event: ${snapshot.event}`,
      `Time: ${new Date().toISOString()}`,
      `User: ${snapshot.userLabel}`,
      `Request: ${snapshot.request.method} ${snapshot.request.path}`,
      `IP: ${snapshot.request.ip}`,
      `Origin: ${snapshot.request.origin}`,
      `Referer: ${snapshot.request.referer}`,
      `UA: ${truncate(snapshot.request.userAgent, 240)}`
    ];

    if (snapshot.details && Object.keys(snapshot.details).length > 0) {
      lines.push('Details:');
      for (const [key, value] of Object.entries(snapshot.details)) {
        if (value === undefined) continue;
        lines.push(`${key}: ${formatValue(value)}`);
      }
    }

    const text = lines.join('\n');
    const payload = {
      text: truncate(text, 3500),
      caption: truncate(text, 900),
      photoUrl: snapshot.photoUrl
    };

    await sendTelegramPayload(c.env, payload);
  })());
};
