import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { app } from '../index';
import { SqliteD1Database } from './sqlite_d1';
import { LocalR2Bucket } from './local_r2';
import type { Env } from '../types';

const dataDir = process.env.CLAN_DATA_DIR || path.resolve('.data');
const avatarsDir = path.join(dataDir, 'avatars');
const dbPath = path.join(dataDir, 'clan-node.sqlite');
const port = Number(process.env.PORT || 8080);
const distRoot = './frontend/dist';

const ensureSchema = async (db: SqliteD1Database) => {
  const schemaSql = await readFile(path.resolve('migrations/schema.sql'), 'utf8');
  const sqlite = db as unknown as { rawDb: { exec: (sql: string) => void } };
  sqlite.rawDb.exec(schemaSql);
};

const buildEnv = (): Env => ({
  DB: new SqliteD1Database(dbPath),
  AVATARS: new LocalR2Bucket(avatarsDir),
  ADMIN_SETUP_TOKEN: process.env.ADMIN_SETUP_TOKEN,
  AUTH_ENCRYPTION_KEY: process.env.AUTH_ENCRYPTION_KEY,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
  ENVIRONMENT: process.env.ENVIRONMENT || 'development',
  EMAIL_VERIFICATION_URL_BASE: process.env.EMAIL_VERIFICATION_URL_BASE,
  PASSWORD_RESET_URL_BASE: process.env.PASSWORD_RESET_URL_BASE,
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  BREVO_FROM_EMAIL: process.env.BREVO_FROM_EMAIL,
  BREVO_FROM_NAME: process.env.BREVO_FROM_NAME,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  DUAL_WRITE_REMOTE: process.env.DUAL_WRITE_REMOTE,
  DUAL_WRITE_REMOTE_BASE: process.env.DUAL_WRITE_REMOTE_BASE,
  DUAL_WRITE_REMOTE_ORIGIN: process.env.DUAL_WRITE_REMOTE_ORIGIN,
  DUAL_WRITE_REMOTE_USER: process.env.DUAL_WRITE_REMOTE_USER,
  DUAL_WRITE_REMOTE_PASS: process.env.DUAL_WRITE_REMOTE_PASS,
  DUAL_WRITE_SHARED_SECRET: process.env.DUAL_WRITE_SHARED_SECRET,
});

await mkdir(avatarsDir, { recursive: true });
const env = buildEnv();
await ensureSchema(env.DB as SqliteD1Database);

const nodeApp = new Hono();
nodeApp.route('/', app);
nodeApp.use('*', serveStatic({ root: distRoot }));
nodeApp.get('*', serveStatic({ path: `${distRoot}/index.html` }));

serve({
  port,
  fetch: (request) => nodeApp.fetch(request, env),
});

console.log(`Clan Node API listening on http://0.0.0.0:${port}`);
