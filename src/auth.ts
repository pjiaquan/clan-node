import type { Context, Hono, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppBindings, Env, UserRole } from './types';
import { notifyUpdate } from './notify';
import { recordAuditLog, recordRateLimitAudit } from './audit';
import { hasConfiguredEncryptionKey, isEncryptedValue } from './data_protection';
import { validateAvatarUpload } from './avatar_validation';
import {
  ACCOUNT_AVATAR_RATE_LIMIT,
  ACCOUNT_LOGIN_RATE_LIMIT,
  FORGOT_PASSWORD_RATE_LIMIT,
  INVITE_CREATE_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  MFA_SEND_RATE_LIMIT,
  MFA_VERIFY_RATE_LIMIT,
  PASSKEY_LOGIN_RATE_LIMIT,
  PASSKEY_REGISTER_RATE_LIMIT,
  RESEND_RATE_LIMIT
} from './rate_limits';
import { getUserSchemaSupport } from './schema';
import type { UserSchemaSupport } from './schema';

const SESSION_COOKIE = 'clan_session';
const PASSKEY_CHALLENGE_COOKIE = 'clan_passkey_challenge';
const textEncoder = new TextEncoder();
const toBufferSource = (value: Uint8Array): ArrayBuffer =>
  Uint8Array.from(value).buffer;
const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const ADMIN_IDLE_SESSION_TTL_MS = 1000 * 60 * 60 * 2;
const DEFAULT_IDLE_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MFA_TTL_MS = 1000 * 60 * 10;
const MFA_MAX_ATTEMPTS = 5;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW_STEPS = 1;
const SESSION_TOKEN_BYTES = 32;
const ENCRYPTED_SECRET_PREFIX = 'enc:v1';
const INVITE_PENDING_PASSWORD_HASH = '__invite_pending__';
const INVITE_PENDING_PASSWORD_SALT = '__invite_pending__';

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const toBase64Url = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const randomBase64 = (size = 16) => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toBase64(bytes.buffer);
};

const randomBase64Url = (size = 16) => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};

const fromBase64 = (value: string) => {
  const normalized = value.replace(/\s+/g, '');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const fromBase64Url = (value: string) => fromBase64(value.replace(/-/g, '+').replace(/_/g, '/'));

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const toBase32 = (bytes: Uint8Array) => {
  let output = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
};

const fromBase32 = (value: string) => {
  const normalized = value.toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error('Invalid base32 secret');
    }
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
};

async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: textEncoder.encode(salt) },
    key,
    256
  );
  return toBase64(bits);
}

async function sha256Base64(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
  return toBase64(digest);
}

async function sha256Base64Url(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
  return toBase64Url(digest);
}

async function hmacSha1(secret: Uint8Array, message: Uint8Array) {
  const key = await crypto.subtle.importKey(
    'raw',
    toBufferSource(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, toBufferSource(message));
  return new Uint8Array(signature);
}

async function hmacSha256(secret: Uint8Array, message: Uint8Array) {
  const key = await crypto.subtle.importKey(
    'raw',
    toBufferSource(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, toBufferSource(message));
  return new Uint8Array(signature);
}

export const timingSafeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
};

const timingSafeEqualBytes = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
};

const normalizeRole = (value: unknown): UserRole => (value === 'admin' ? 'admin' : 'readonly');

const normalizeIdentifier = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeEmail = (value: unknown): string => {
  return normalizeIdentifier(value).toLowerCase();
};

type PasskeyClientData = {
  type: string;
  challenge: string;
  origin: string;
  rawBytes: Uint8Array;
};

type PasskeyChallengeState = {
  challenge: string;
  flow: 'register' | 'login';
  userId: string | null;
  expiresAt: string;
};

const normalizeOtpCode = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.replace(/\D+/g, '').trim();
};

const isValidEmail = (value: string): boolean => (
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
);

const isInvitePendingPassword = (passwordHash: unknown, passwordSalt: unknown) => (
  passwordHash === INVITE_PENDING_PASSWORD_HASH && passwordSalt === INVITE_PENDING_PASSWORD_SALT
);

const validatePasswordStrength = (password: string, relatedValues: string[] = []) => {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must include at least one lowercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must include at least one number';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include at least one symbol';
  }

  const normalizedPassword = password.toLowerCase();
  const normalizedVariants = Array.from(
    new Set(
      relatedValues
        .map((value) => normalizeIdentifier(value).toLowerCase())
        .filter(Boolean)
    )
  );
  for (const variant of normalizedVariants) {
    if (variant.length >= 3 && normalizedPassword.includes(variant)) {
      return 'Password must not contain your email or username';
    }
    const localPart = variant.includes('@') ? variant.split('@')[0] || '' : '';
    if (localPart.length >= 3 && normalizedPassword.includes(localPart)) {
      return 'Password must not contain your email or username';
    }
  }

  return null;
};

const createTotpSecret = () => {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return toBase32(bytes);
};

const buildTotpOtpAuthUrl = (email: string, secret: string) => {
  const issuer = 'Clan Node';
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
};

const generateTotpCodeForCounter = async (secret: string, counter: number) => {
  const secretBytes = fromBase32(secret);
  const message = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i -= 1) {
    message[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  const digest = await hmacSha1(secretBytes, message);
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  );
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
};

const verifyTotpCode = async (secret: string, code: string) => {
  if (!/^\d{6}$/.test(code)) return false;
  const currentCounter = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset += 1) {
    const expected = await generateTotpCodeForCounter(secret, currentCounter + offset);
    if (timingSafeEqual(expected, code)) {
      return true;
    }
  }
  return false;
};

type SessionSchemaSupport = {
  hasUserAgent: boolean;
  hasIpAddress: boolean;
  hasLastSeenAt: boolean;
};

let sessionSchemaSupportCache: SessionSchemaSupport | null = null;
let authRateLimitTableReady = false;
let authMfaTableReady = false;
let authMfaSessionTableReady = false;
let passwordResetTokenTableReady = false;
let cachedEncryptionKeySource: string | null = null;
let cachedEncryptionKey: CryptoKey | null = null;
let encryptionKeyWarningShown = false;
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60;
const MAX_AVATAR_BYTES = 20 * 1024 * 1024;

const parseEncryptionKeyBytes = (value: string): Uint8Array => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('AUTH_ENCRYPTION_KEY is empty');
  }

  try {
    const decoded = fromBase64Url(trimmed);
    if (decoded.byteLength === 32) {
      return decoded;
    }
  } catch {
    // Fall through to raw-key handling.
  }

  const raw = textEncoder.encode(trimmed);
  if (raw.byteLength === 32) {
    return raw;
  }

  throw new Error('AUTH_ENCRYPTION_KEY must be 32 raw bytes/chars or a base64/base64url-encoded 32-byte key');
};

const getEncryptionKey = async (env: Env): Promise<CryptoKey | null> => {
  const keySource = env.AUTH_ENCRYPTION_KEY?.trim() || '';
  if (!keySource) {
    if (env.ENVIRONMENT === 'production') {
      throw new Error('AUTH_ENCRYPTION_KEY must be set in production to protect sensitive data.');
    }
    if (!encryptionKeyWarningShown) {
      encryptionKeyWarningShown = true;
      console.warn('AUTH_ENCRYPTION_KEY is not set; MFA secrets will remain stored in plaintext.');
    }
    return null;
  }
  if (cachedEncryptionKey && cachedEncryptionKeySource === keySource) {
    return cachedEncryptionKey;
  }
  const keyBytes = parseEncryptionKeyBytes(keySource);
  cachedEncryptionKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(keyBytes),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  cachedEncryptionKeySource = keySource;
  return cachedEncryptionKey;
};

const requireProductionSecret = (
  c: Context<AppBindings>,
  key: keyof Pick<Env, 'AUTH_ENCRYPTION_KEY' | 'ADMIN_SETUP_TOKEN'>,
  feature: string
) => {
  if (c.env.ENVIRONMENT !== 'production') return null;
  if (typeof c.env[key] === 'string' && c.env[key]?.trim()) {
    return null;
  }
  return c.json({ error: `Server misconfiguration: ${key} is required in production for ${feature}` }, 503);
};

const encryptSecret = async (env: Env, plaintext: string): Promise<string> => {
  const key = await getEncryptionKey(env);
  if (!key) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(plaintext)
  );
  return `${ENCRYPTED_SECRET_PREFIX}:${toBase64Url(iv)}:${toBase64Url(cipher)}`;
};

const decryptSecret = async (env: Env, value: string | null | undefined): Promise<string | null> => {
  if (!value) return null;
  if (!value.startsWith(`${ENCRYPTED_SECRET_PREFIX}:`)) {
    return value;
  }
  const parts = value.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted secret payload');
  }
  const key = await getEncryptionKey(env);
  if (!key) {
    throw new Error('AUTH_ENCRYPTION_KEY is required to decrypt stored secrets');
  }
  const iv = fromBase64Url(parts[2]);
  const cipher = fromBase64Url(parts[3]);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipher
  );
  return new TextDecoder().decode(plaintext);
};

const migrateStoredTotpSecretIfNeeded = async (
  db: D1Database,
  env: Env,
  userId: string,
  value: string | null | undefined
) => {
  if (!value || isEncryptedValue(value) || !hasConfiguredEncryptionKey(env)) {
    return;
  }
  const encrypted = await encryptSecret(env, value);
  if (!encrypted || encrypted === value) return;
  await db.prepare(
    'UPDATE users SET mfa_totp_secret = ?, updated_at = ? WHERE id = ?'
  ).bind(encrypted, new Date().toISOString(), userId).run();
};

const createSessionToken = () => randomBase64Url(SESSION_TOKEN_BYTES);

const hashSessionToken = async (token: string) => `s1_${await sha256Base64Url(token)}`;

const getSessionLookupIds = async (sessionToken: string) => {
  const ids = new Set<string>([sessionToken]);
  ids.add(await hashSessionToken(sessionToken));
  return Array.from(ids);
};

const addSessionColumnIfMissing = async (
  db: D1Database,
  existing: Set<string>,
  column: string,
  ddl: string
) => {
  if (existing.has(column)) return;
  try {
    await db.prepare(`ALTER TABLE sessions ADD COLUMN ${ddl}`).run();
    existing.add(column);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('duplicate column name')) {
      existing.add(column);
      return;
    }
    throw error;
  }
};

const getSessionSchemaSupport = async (db: D1Database): Promise<SessionSchemaSupport> => {
  if (sessionSchemaSupportCache) return sessionSchemaSupportCache;
  const { results } = await db.prepare("PRAGMA table_info('sessions')").all();
  const names = new Set(
    results
      .map((row) => (row as any).name as string)
      .filter(Boolean)
  );
  // Self-heal old databases created before session metadata fields existed.
  await addSessionColumnIfMissing(db, names, 'user_agent', 'user_agent TEXT');
  await addSessionColumnIfMissing(db, names, 'ip_address', 'ip_address TEXT');
  await addSessionColumnIfMissing(db, names, 'last_seen_at', 'last_seen_at TEXT');
  sessionSchemaSupportCache = {
    hasUserAgent: names.has('user_agent'),
    hasIpAddress: names.has('ip_address'),
    hasLastSeenAt: names.has('last_seen_at')
  };
  return sessionSchemaSupportCache;
};

const getEmailActionBaseUrl = (env: Env) => {
  const base = (env.EMAIL_VERIFICATION_URL_BASE || env.FRONTEND_ORIGIN || 'http://localhost:5173')
    .split(',')[0]
    ?.trim()
    .replace(/\/+$/, '');
  return base || 'http://localhost:5173';
};

const buildVerificationUrl = (env: Env, token: string) => (
  `${getEmailActionBaseUrl(env)}?verify_email_token=${encodeURIComponent(token)}`
);

const buildInvitationUrl = (env: Env, token: string) => (
  `${getEmailActionBaseUrl(env)}?invite_token=${encodeURIComponent(token)}`
);

const buildPasswordResetUrl = (env: Env, token: string) => {
  const base = (env.PASSWORD_RESET_URL_BASE || env.EMAIL_VERIFICATION_URL_BASE || env.FRONTEND_ORIGIN || 'http://localhost:5173')
    .split(',')[0]
    ?.trim()
    .replace(/\/+$/, '');
  return `${base || 'http://localhost:5173'}?reset_password_token=${encodeURIComponent(token)}`;
};

const sendTransactionalEmail = async (
  env: Env,
  input: { to: string; subject: string; textContent: string; htmlContent: string }
) => {
  const apiKey = env.BREVO_API_KEY || '';
  const fromEmail = env.BREVO_FROM_EMAIL || '';
  const fromName = env.BREVO_FROM_NAME || 'Clan Node';
  if (!apiKey || !fromEmail) {
    console.warn('Email delivery skipped: missing BREVO_API_KEY or BREVO_FROM_EMAIL');
    return false;
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: input.to }],
      subject: input.subject,
      textContent: input.textContent,
      htmlContent: input.htmlContent
    })
  });
  if (!response.ok) {
    const text = await response.text();
    console.warn('Failed to send email:', response.status, text);
    return false;
  }
  return true;
};

const sendVerificationEmail = async (env: Env, to: string, verifyUrl: string) => sendTransactionalEmail(env, {
  to,
  subject: 'Verify your email',
  textContent: `Please verify your email by visiting: ${verifyUrl}`,
  htmlContent: `<p>Please verify your email:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`
});

const sendInvitationEmail = async (env: Env, to: string, inviteUrl: string) => sendTransactionalEmail(env, {
  to,
  subject: 'You are invited to Clan Node',
  textContent: `You have been invited to Clan Node. Accept your invitation and set your password here: ${inviteUrl}`,
  htmlContent: `<p>You have been invited to Clan Node.</p><p><a href="${inviteUrl}">Accept your invitation and set your password</a></p>`
});

const sendMfaCodeEmail = async (env: Env, to: string, code: string) => sendTransactionalEmail(env, {
  to,
  subject: 'Your sign-in code',
  textContent: `Your sign-in code is ${code}. It expires in 10 minutes.`,
  htmlContent: `<p>Your sign-in code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`
});

const sendPasswordChangedEmail = async (env: Env, to: string) => sendTransactionalEmail(env, {
  to,
  subject: 'Your password was changed',
  textContent: 'Your Family Tree password was changed. If this was not you, contact an administrator immediately.',
  htmlContent: '<p>Your Family Tree password was changed.</p><p>If this was not you, contact an administrator immediately.</p>'
});

const sendPasswordResetEmail = async (env: Env, to: string, resetUrl: string) => sendTransactionalEmail(env, {
  to,
  subject: 'Reset your password',
  textContent: `Reset your password by visiting: ${resetUrl}`,
  htmlContent: `<p>Reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
});

const createVerificationToken = async () => {
  const token = randomBase64(32).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const tokenHash = await sha256Base64(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
  return { token, tokenHash, expiresAt };
};

const createPasswordResetToken = async () => {
  const token = randomBase64(32).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const tokenHash = await sha256Base64(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
  return { token, tokenHash, expiresAt };
};

const createMfaCode = async () => {
  const randomValue = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  const code = String(randomValue % 1000000).padStart(6, '0');
  const codeHash = await sha256Base64(code);
  const expiresAt = new Date(Date.now() + MFA_TTL_MS).toISOString();
  return { code, codeHash, expiresAt };
};

const maskEmail = (email: string) => {
  const [localPart, domain = ''] = email.split('@');
  if (!domain) return email;
  const visibleLocal = localPart.length <= 2
    ? `${localPart[0] || '*'}*`
    : `${localPart[0]}${'*'.repeat(Math.max(1, localPart.length - 2))}${localPart[localPart.length - 1]}`;
  return `${visibleLocal}@${domain}`;
};

const hasUsableEmailAccount = async (db: D1Database) => {
  const userSchema = await getUserSchemaSupport(db);
  if (!userSchema.hasEmailVerifiedAt) {
    return false;
  }
  const emailField = userSchema.hasEmail ? 'email' : 'username';
  const existing = await db.prepare(
    `SELECT id
     FROM users
     WHERE ${emailField} IS NOT NULL
       AND TRIM(${emailField}) != ''
       AND INSTR(${emailField}, '@') > 1
       AND INSTR(SUBSTR(${emailField}, INSTR(${emailField}, '@') + 1), '.') > 0
       AND email_verified_at IS NOT NULL
       AND TRIM(email_verified_at) != ''
     LIMIT 1`
  ).first();
  return Boolean(existing);
};

const ensureAuthRateLimitTable = async (db: D1Database) => {
  if (authRateLimitTableReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS auth_rate_limits (
      action TEXT NOT NULL,
      limiter_key TEXT NOT NULL,
      window_start_ms INTEGER NOT NULL,
      count INTEGER NOT NULL,
      blocked_until_ms INTEGER,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (action, limiter_key)
    )`
  ).run();
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_blocked_until ON auth_rate_limits(blocked_until_ms)'
  ).run();
  authRateLimitTableReady = true;
};

const ensureAuthMfaTable = async (db: D1Database) => {
  if (authMfaTableReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  ).run();
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_user ON auth_mfa_challenges(user_id)'
  ).run();
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_expires_at ON auth_mfa_challenges(expires_at)'
  ).run();
  authMfaTableReady = true;
};

const ensureAuthMfaSessionTable = async (db: D1Database) => {
  if (authMfaSessionTableReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS auth_mfa_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  ).run();
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_auth_mfa_sessions_user ON auth_mfa_sessions(user_id)'
  ).run();
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_auth_mfa_sessions_expires_at ON auth_mfa_sessions(expires_at)'
  ).run();
  authMfaSessionTableReady = true;
};

const ensurePasswordResetTokenTable = async (db: D1Database) => {
  if (passwordResetTokenTableReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      requested_ip TEXT,
      requested_user_agent TEXT,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  ).run();
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id)'
  ).run();
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at)'
  ).run();
  passwordResetTokenTableReady = true;
};

type RateLimitInput = {
  action: string;
  limiterKey: string;
  windowMs: number;
  maxAttempts: number;
  blockMs: number;
};

export const checkAndConsumeRateLimit = async (db: D1Database, input: RateLimitInput) => {
  await ensureAuthRateLimitTable(db);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const existing = await db.prepare(
    `SELECT window_start_ms, count, blocked_until_ms
     FROM auth_rate_limits
     WHERE action = ? AND limiter_key = ?`
  ).bind(input.action, input.limiterKey).first();

  if (!existing) {
    await db.prepare(
      `INSERT INTO auth_rate_limits (action, limiter_key, window_start_ms, count, blocked_until_ms, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).bind(input.action, input.limiterKey, nowMs, 1, nowIso).run();
    return { allowed: true as const };
  }

  const blockedUntilMs = Number((existing as any).blocked_until_ms ?? 0);
  if (blockedUntilMs > nowMs) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((blockedUntilMs - nowMs) / 1000))
    };
  }

  const windowStartMs = Number((existing as any).window_start_ms ?? 0);
  const count = Number((existing as any).count ?? 0);
  const inWindow = nowMs - windowStartMs <= input.windowMs;

  if (!inWindow) {
    await db.prepare(
      `UPDATE auth_rate_limits
       SET window_start_ms = ?, count = 1, blocked_until_ms = NULL, updated_at = ?
       WHERE action = ? AND limiter_key = ?`
    ).bind(nowMs, nowIso, input.action, input.limiterKey).run();
    return { allowed: true as const };
  }

  if (count >= input.maxAttempts) {
    const nextBlockedUntil = nowMs + input.blockMs;
    await db.prepare(
      `UPDATE auth_rate_limits
       SET blocked_until_ms = ?, updated_at = ?
       WHERE action = ? AND limiter_key = ?`
    ).bind(nextBlockedUntil, nowIso, input.action, input.limiterKey).run();
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil(input.blockMs / 1000))
    };
  }

  await db.prepare(
    `UPDATE auth_rate_limits
     SET count = ?, updated_at = ?
     WHERE action = ? AND limiter_key = ?`
  ).bind(count + 1, nowIso, input.action, input.limiterKey).run();

  return { allowed: true as const };
};

type AccountRow = {
  id: string;
  username: string;
  email: string;
  email_verified_at: string | null;
  role: UserRole;
  avatar_url: string | null;
  linked_person_id: string | null;
  linked_person_name: string | null;
  created_at: string;
  updated_at: string;
};

const mapAccountRow = (row: any, userSchema: UserSchemaSupport): AccountRow => ({
  id: String(row.id),
  username: String(row.username),
  email: userSchema.hasEmail ? String(row.email ?? row.username) : String(row.username),
  email_verified_at: userSchema.hasEmailVerifiedAt ? ((row.email_verified_at as string | null) ?? null) : null,
  role: normalizeRole(row.role),
  avatar_url: userSchema.hasAvatarUrl ? ((row.avatar_url as string | null) ?? null) : null,
  linked_person_id: ((row.linked_person_id as string | null) ?? null),
  linked_person_name: ((row.linked_person_name as string | null) ?? null),
  created_at: String(row.created_at),
  updated_at: String(row.updated_at)
});

const getAccountById = async (db: D1Database, userId: string) => {
  const userSchema = await getUserSchemaSupport(db);
  const fields = ['id', 'username', 'role', 'created_at', 'updated_at'];
  if (userSchema.hasEmail) fields.push('email');
  if (userSchema.hasEmailVerifiedAt) fields.push('email_verified_at');
  if (userSchema.hasAvatarUrl) fields.push('avatar_url');
  const peoplePragma = await db.prepare("PRAGMA table_info('people')").all();
  const peopleHasEmail = (peoplePragma.results as Array<Record<string, unknown>>)
    .some((row) => String((row as any).name) === 'email');
  const linkedPersonFields = peopleHasEmail
    ? `, (
          SELECT p.id
          FROM people p
          WHERE LOWER(TRIM(COALESCE(p.email, ''))) = LOWER(TRIM(COALESCE(users.${userSchema.hasEmail ? 'email' : 'username'}, '')))
          ORDER BY p.updated_at DESC, p.created_at DESC, p.id DESC
          LIMIT 1
        ) AS linked_person_id,
        (
          SELECT p.name
          FROM people p
          WHERE LOWER(TRIM(COALESCE(p.email, ''))) = LOWER(TRIM(COALESCE(users.${userSchema.hasEmail ? 'email' : 'username'}, '')))
          ORDER BY p.updated_at DESC, p.created_at DESC, p.id DESC
          LIMIT 1
        ) AS linked_person_name,
        (
          SELECT COALESCE(
            (
              SELECT pa.avatar_url
              FROM person_avatars pa
              WHERE pa.person_id = p.id
              ORDER BY pa.is_primary DESC, pa.sort_order ASC, pa.created_at ASC
              LIMIT 1
            ),
            p.avatar_url
          )
          FROM people p
          WHERE LOWER(TRIM(COALESCE(p.email, ''))) = LOWER(TRIM(COALESCE(users.${userSchema.hasEmail ? 'email' : 'username'}, '')))
          ORDER BY p.updated_at DESC, p.created_at DESC, p.id DESC
          LIMIT 1
        ) AS linked_person_avatar_url`
    : ', NULL AS linked_person_id, NULL AS linked_person_name, NULL AS linked_person_avatar_url';
  const row = await db.prepare(
    `SELECT ${fields.join(', ')}${linkedPersonFields} FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!row) return null;
  const account = mapAccountRow(row, userSchema);
  const linkedAvatarUrl = ((row as any).linked_person_avatar_url as string | null) ?? null;
  if (linkedAvatarUrl) {
    account.avatar_url = linkedAvatarUrl;
  }
  return { userSchema, account };
};

const revokeUserSessions = async (db: D1Database, userId: string, keepToken: string | null = null) => {
  if (!keepToken) {
    const result = await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
    return Number(result.meta?.changes ?? 0);
  }
  const keepIds = await getSessionLookupIds(keepToken);
  const result = await db.prepare(
    `DELETE FROM sessions
     WHERE user_id = ?
       AND id NOT IN (${keepIds.map(() => '?').join(', ')})`
  ).bind(userId, ...keepIds).run();
  return Number(result.meta?.changes ?? 0);
};

const clearRateLimit = async (
  db: D1Database,
  action: RateLimitInput['action'],
  limiterKey: string
) => {
  await ensureAuthRateLimitTable(db);
  await db.prepare(
    'DELETE FROM auth_rate_limits WHERE action = ? AND limiter_key = ?'
  ).bind(action, limiterKey).run();
};

const getRequestUserAgent = (c: Context<AppBindings>) => (
  c.req.header('User-Agent')
  || c.req.header('user-agent')
  || null
);

export const getRequestIpAddress = (c: Context<AppBindings>) => {
  const cfIp = c.req.header('CF-Connecting-IP') || c.req.header('cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwarded = c.req.header('x-forwarded-for');
  if (!forwarded) return null;
  return forwarded.split(',')[0]?.trim() || null;
};

const recordLoginAttempt = async (
  c: Context<AppBindings>,
  input: {
    email: string;
    success: boolean;
    reason: string;
    userId?: string | null;
    role?: UserRole | null;
  }
) => {
  await recordAuditLog(c, {
    action: input.success ? 'login_success' : 'login_failed',
    resourceType: 'auth',
    resourceId: input.userId ?? input.email,
    summary: input.success ? `登入成功 ${input.email}` : `登入失敗 ${input.email}`,
    details: {
      email: input.email,
      success: input.success,
      reason: input.reason,
      role: input.role ?? null,
      ip_address: getRequestIpAddress(c),
      user_agent: getRequestUserAgent(c)
    }
  });
};

const createSession = async (
  c: Context<AppBindings>,
  user: { id: string; username: string; role: UserRole }
) => {
  const sessionToken = createSessionToken();
  const sessionId = await hashSessionToken(sessionToken);
  const now = new Date();
  const sessionTtlMs = user.role === 'admin' ? ADMIN_SESSION_TTL_MS : DEFAULT_SESSION_TTL_MS;
  const expiresAt = new Date(now.getTime() + sessionTtlMs);
  const schema = await getSessionSchemaSupport(c.env.DB);
  const columns = ['id', 'user_id', 'created_at', 'expires_at'];
  const values: Array<string | null> = [
    sessionId,
    user.id,
    now.toISOString(),
    expiresAt.toISOString()
  ];
  if (schema.hasUserAgent) {
    columns.push('user_agent');
    values.push(getRequestUserAgent(c));
  }
  if (schema.hasIpAddress) {
    columns.push('ip_address');
    values.push(getRequestIpAddress(c));
  }
  if (schema.hasLastSeenAt) {
    columns.push('last_seen_at');
    values.push(now.toISOString());
  }
  await c.env.DB.prepare(
    `INSERT INTO sessions (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).bind(...values).run();

  const isSecure = isSecureRequest(c.env);
  setCookie(c, SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    path: '/',
    sameSite: isSecure ? 'None' : 'Lax',
    secure: isSecure,
    expires: expiresAt
  });

  return { sessionId: sessionToken, expiresAt };
};

const createMfaChallenge = async (
  c: Context<AppBindings>,
  input: { userId: string; email: string }
) => {
  await ensureAuthMfaTable(c.env.DB);
  await c.env.DB.prepare(
    'DELETE FROM auth_mfa_challenges WHERE user_id = ? OR expires_at <= ?'
  ).bind(input.userId, new Date().toISOString()).run();

  const { code, codeHash, expiresAt } = await createMfaCode();
  const challengeId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO auth_mfa_challenges (
      id, user_id, email, code_hash, expires_at, attempt_count, max_attempts, created_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).bind(
    challengeId,
    input.userId,
    input.email,
    codeHash,
    expiresAt,
    MFA_MAX_ATTEMPTS,
    new Date().toISOString()
  ).run();

  const delivered = await sendMfaCodeEmail(c.env, input.email, code);
  return {
    challengeId,
    code,
    delivered,
    expiresAt
  };
};

const createMfaSession = async (
  c: Context<AppBindings>,
  input: { userId: string; email: string }
) => {
  await ensureAuthMfaSessionTable(c.env.DB);
  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    'DELETE FROM auth_mfa_sessions WHERE user_id = ? OR expires_at <= ?'
  ).bind(input.userId, nowIso).run();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + MFA_TTL_MS).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO auth_mfa_sessions (
      id, user_id, email, expires_at, attempt_count, max_attempts, created_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).bind(sessionId, input.userId, input.email, expiresAt, MFA_MAX_ATTEMPTS, nowIso).run();
  return { sessionId, expiresAt };
};

const getMfaSession = async (db: D1Database, sessionId: string) => {
  await ensureAuthMfaSessionTable(db);
  return db.prepare(
    `SELECT id, user_id, email, expires_at, attempt_count, max_attempts
     FROM auth_mfa_sessions
     WHERE id = ?`
  ).bind(sessionId).first();
};

const issueEmailFallbackChallenge = async (
  c: Context<AppBindings>,
  input: { userId: string; email: string; role: UserRole }
) => {
  const mfaRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
    action: 'login_mfa_send',
    limiterKey: input.email,
    windowMs: MFA_SEND_RATE_LIMIT.windowMs,
    maxAttempts: MFA_SEND_RATE_LIMIT.maxAttempts,
    blockMs: MFA_SEND_RATE_LIMIT.blockMs
  });
  if (!mfaRateLimit.allowed) {
    return {
      ok: false as const,
      retryAfterSeconds: mfaRateLimit.retryAfterSeconds
    };
  }

  const challenge = await createMfaChallenge(c, {
    userId: input.userId,
    email: input.email
  });
  if (!challenge.delivered && c.env.ENVIRONMENT === 'production') {
    await c.env.DB.prepare(
      'DELETE FROM auth_mfa_challenges WHERE id = ?'
    ).bind(challenge.challengeId).run();
    await recordLoginAttempt(c, {
      email: input.email,
      success: false,
      reason: 'mfa_delivery_failed',
      userId: input.userId,
      role: input.role
    });
    return {
      ok: false as const,
      deliveryFailed: true as const
    };
  }

  return {
    ok: true as const,
    challenge
  };
};

const classifyClient = (userAgent?: string | null) => {
  const ua = (userAgent || '').toLowerCase();
  let browser = 'Unknown';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('samsungbrowser/')) browser = 'Samsung Internet';
  else if (ua.includes('crios/')) browser = 'Chrome (iOS)';
  else if (ua.includes('chrome/')) browser = 'Chrome';
  else if (ua.includes('firefox/')) browser = 'Firefox';
  else if (ua.includes('safari/') && !ua.includes('chrome/') && !ua.includes('crios/')) browser = 'Safari';
  else if (ua.includes('wv')) browser = 'WebView';

  let platform = 'Unknown';
  if (ua.includes('android')) platform = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) platform = 'iOS';
  else if (ua.includes('windows')) platform = 'Windows';
  else if (ua.includes('mac os')) platform = 'macOS';
  else if (ua.includes('linux')) platform = 'Linux';

  const deviceLabel = platform === 'Unknown' ? browser : `${platform} · ${browser}`;
  return { browser, platform, deviceLabel };
};

async function getSessionUser(db: D1Database, sessionId: string) {
  const lookupIds = await getSessionLookupIds(sessionId);
  const now = new Date().toISOString();
  const row = await db.prepare(
    `SELECT s.id as session_id, s.user_id as user_id, s.created_at as created_at, s.expires_at as expires_at,
            s.last_seen_at as last_seen_at,
            u.username as username, u.role as role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id IN (${lookupIds.map(() => '?').join(', ')}) AND s.expires_at > ?
     ORDER BY s.created_at DESC
     LIMIT 1`
  ).bind(...lookupIds, now).first();
  if (!row) return null;
  const role = normalizeRole((row as any).role);
  const idleTtlMs = role === 'admin' ? ADMIN_IDLE_SESSION_TTL_MS : DEFAULT_IDLE_SESSION_TTL_MS;
  const lastSeenRaw = ((row as any).last_seen_at as string | null) || ((row as any).created_at as string | null) || null;
  if (lastSeenRaw) {
    const lastSeenMs = Date.parse(lastSeenRaw);
    if (Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs > idleTtlMs) {
      await db.prepare('DELETE FROM sessions WHERE id = ?').bind((row as any).session_id as string).run();
      return null;
    }
  }
  return {
    sessionId: (row as any).session_id as string,
    userId: (row as any).user_id as string,
    username: (row as any).username as string,
    role
  };
}

const isSecureRequest = (env: Env) => env.ENVIRONMENT === 'production';

const clearSessionCookie = (c: Context<AppBindings>) => {
  const isSecure = isSecureRequest(c.env);
  deleteCookie(c, SESSION_COOKIE, { path: '/', sameSite: isSecure ? 'None' : 'Lax', secure: isSecure });
};

const getSessionIdFromRequest = (c: Context<AppBindings>) => {
  const cookieSession = getCookie(c, SESSION_COOKIE);
  return cookieSession || null;
};

export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const path = c.req.path;
  if (
    path.startsWith('/api/auth/login')
    || path.startsWith('/api/auth/mfa/send-email')
    || path.startsWith('/api/auth/mfa/verify-totp')
    || path.startsWith('/api/auth/setup')
    || path.startsWith('/api/auth/accept-invite')
    || path.startsWith('/api/auth/verify-mfa')
    || path.startsWith('/api/auth/verify-email')
    || path.startsWith('/api/auth/resend-verification')
    || path.startsWith('/api/auth/forgot-password')
    || path.startsWith('/api/auth/reset-password')
    || path.startsWith('/api/auth/passkey/login')
  ) {
    return next();
  }
  if (path.startsWith('/api/auth/me')) {
    return next();
  }

  const sessionId = getSessionIdFromRequest(c);
  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionUser = await getSessionUser(c.env.DB, sessionId);
  if (!sessionUser) {
    clearSessionCookie(c);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('sessionUser', {
    userId: sessionUser.userId,
    username: sessionUser.username,
    role: sessionUser.role
  });

  try {
    const schema = await getSessionSchemaSupport(c.env.DB);
    const updates: string[] = [];
    const values: Array<string | null> = [];
    if (schema.hasLastSeenAt) {
      updates.push('last_seen_at = ?');
      values.push(new Date().toISOString());
    }
    if (schema.hasUserAgent) {
      updates.push('user_agent = COALESCE(user_agent, ?)');
      values.push(getRequestUserAgent(c));
    }
    if (schema.hasIpAddress) {
      updates.push('ip_address = COALESCE(ip_address, ?)');
      values.push(getRequestIpAddress(c));
    }
    if (updates.length > 0) {
      await c.env.DB.prepare(
        `UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...values, sessionUser.sessionId).run();
    }
  } catch (error) {
    console.warn('Failed to update session metadata:', error);
  }

  return next();
};

export const requireWriteAccess: MiddlewareHandler<AppBindings> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const path = c.req.path;
  if (
    path.startsWith('/api/auth/login')
    || path.startsWith('/api/auth/mfa/send-email')
    || path.startsWith('/api/auth/mfa/verify-totp')
    || path.startsWith('/api/auth/mfa/totp/setup')
    || path.startsWith('/api/auth/mfa/totp/confirm')
    || path.startsWith('/api/auth/setup')
    || path.startsWith('/api/auth/accept-invite')
    || path.startsWith('/api/auth/verify-mfa')
    || path.startsWith('/api/auth/verify-email')
    || path.startsWith('/api/auth/resend-verification')
    || path.startsWith('/api/auth/forgot-password')
    || path.startsWith('/api/auth/reset-password')
    || path.startsWith('/api/auth/logout')
    || path.startsWith('/api/auth/sessions')
    || path.startsWith('/api/auth/account')
    || path.startsWith('/api/auth/passkey')
    || path.startsWith('/api/auth/passkeys')
  ) {
    return next();
  }

  const sessionUser = c.get('sessionUser');
  if (!sessionUser || sessionUser.role !== 'admin') {
    return c.json({ error: 'Read-only account' }, 403);
  }

  return next();
};

export const requireCsrf: MiddlewareHandler<AppBindings> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const normalize = (value: string) => value.replace(/\/+$/, '').toLowerCase();
  const allowedOrigins = (c.env.FRONTEND_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(entry => normalize(entry.trim()))
    .filter(Boolean);
  const originHeader = c.req.header('Origin') || c.req.header('origin');
  const refererHeader = c.req.header('Referer') || c.req.header('referer');
  const origin = originHeader
    || (refererHeader ? (() => {
      try {
        return new URL(refererHeader).origin;
      } catch {
        return '';
      }
    })() : '');

  if (!origin) {
    console.warn('CSRF blocked: missing Origin/Referer', {
      method,
      path: c.req.path,
      referer: refererHeader || null
    });
    return c.json({ error: 'Forbidden' }, 403);
  }

  const normalizedOrigin = normalize(origin);
  if (!allowedOrigins.includes(normalizedOrigin)) {
    console.warn('CSRF blocked: disallowed origin', {
      method,
      path: c.req.path,
      origin,
      referer: refererHeader || null,
      allowedOrigins
    });
    return c.json({ error: 'Forbidden' }, 403);
  }

  return next();
};

const deleteSessionsByToken = async (db: D1Database, sessionToken: string) => {
  const lookupIds = await getSessionLookupIds(sessionToken);
  await db.prepare(
    `DELETE FROM sessions WHERE id IN (${lookupIds.map(() => '?').join(', ')})`
  ).bind(...lookupIds).run();
};

const matchesSessionToken = async (storedSessionId: string, sessionToken: string | null) => {
  if (!sessionToken) return false;
  if (storedSessionId === sessionToken) return true;
  return storedSessionId === await hashSessionToken(sessionToken);
};

export function registerAuthRoutes(app: Hono<AppBindings>) {
  // Passkey helpers
  // ---------------------------------------------------------------------------

  const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;

  let passkeysTableReady = false;

  const ensurePasskeysTable = async (db: D1Database) => {
    if (passkeysTableReady) return;
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS auth_passkeys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        credential_id TEXT NOT NULL,
        credential_public_key TEXT NOT NULL,
        algorithm INTEGER NOT NULL DEFAULT -7,
        counter INTEGER NOT NULL DEFAULT 0,
        device_type TEXT NOT NULL DEFAULT 'single_device',
        backup_eligible INTEGER NOT NULL DEFAULT 0 CHECK(backup_eligible IN (0, 1)),
        backup_state INTEGER NOT NULL DEFAULT 0 CHECK(backup_state IN (0, 1)),
        name TEXT,
        last_used_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )`
    ).run();
    await db.prepare(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_passkeys_credential_id ON auth_passkeys(credential_id)'
    ).run();
    await db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_passkeys_user ON auth_passkeys(user_id)'
    ).run();
    passkeysTableReady = true;
  };

  const getRpId = (env: Env): string => {
    if (env.ENVIRONMENT === 'production') {
      const origin = (env.FRONTEND_ORIGIN || '').split(',')[0]?.trim() || '';
      try {
        return new URL(origin).hostname;
      } catch {
        return 'localhost';
      }
    }
    return 'localhost';
  };

  const getExpectedOrigin = (env: Env): string => {
    const origin = (env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',')[0]?.trim() || '';
    return origin || 'http://localhost:5173';
  };

  const sha256Raw = async (input: string): Promise<Uint8Array> => {
    const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
    return new Uint8Array(digest);
  };

  const sha256Bytes = async (input: Uint8Array): Promise<Uint8Array> => {
    const digest = await crypto.subtle.digest('SHA-256', toBufferSource(input));
    return new Uint8Array(digest);
  };

  const getPasskeyChallengeSecret = (env: Env): string | null => {
    const candidates = [
      env.AUTH_ENCRYPTION_KEY,
      env.ADMIN_SETUP_TOKEN,
      env.DUAL_WRITE_SHARED_SECRET
    ];
    for (const candidate of candidates) {
      const normalized = candidate?.trim();
      if (normalized) return normalized;
    }
    if (env.ENVIRONMENT === 'production') {
      return null;
    }
    return 'dev-passkey-challenge-secret';
  };

  const setPasskeyChallengeCookie = async (
    c: Context<AppBindings>,
    input: { challenge: string; flow: PasskeyChallengeState['flow']; userId?: string | null }
  ) => {
    const secret = getPasskeyChallengeSecret(c.env);
    if (!secret) {
      throw new Error('Passkey challenge secret is not configured');
    }
    const state: PasskeyChallengeState = {
      challenge: input.challenge,
      flow: input.flow,
      userId: input.userId ?? null,
      expiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_TTL_MS).toISOString()
    };
    const payload = toBase64Url(textEncoder.encode(JSON.stringify(state)));
    const signature = toBase64Url(await hmacSha256(textEncoder.encode(secret), textEncoder.encode(payload)));
    const isSecure = isSecureRequest(c.env);
    setCookie(c, PASSKEY_CHALLENGE_COOKIE, `${payload}.${signature}`, {
      httpOnly: true,
      path: '/',
      sameSite: isSecure ? 'None' : 'Lax',
      secure: isSecure,
      expires: new Date(state.expiresAt)
    });
    return state;
  };

  const clearPasskeyChallengeCookie = (c: Context<AppBindings>) => {
    const isSecure = isSecureRequest(c.env);
    deleteCookie(c, PASSKEY_CHALLENGE_COOKIE, {
      path: '/',
      sameSite: isSecure ? 'None' : 'Lax',
      secure: isSecure
    });
  };

  const getPasskeyChallengeState = async (c: Context<AppBindings>): Promise<PasskeyChallengeState | null> => {
    const cookieValue = getCookie(c, PASSKEY_CHALLENGE_COOKIE);
    if (!cookieValue) return null;
    const secret = getPasskeyChallengeSecret(c.env);
    if (!secret) return null;
    const [payload, signature] = cookieValue.split('.');
    if (!payload || !signature) return null;
    const expected = await hmacSha256(textEncoder.encode(secret), textEncoder.encode(payload));
    const actual = fromBase64Url(signature);
    if (!timingSafeEqualBytes(expected, actual)) {
      return null;
    }
    try {
      const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as PasskeyChallengeState;
      if (!decoded || typeof decoded.challenge !== 'string' || typeof decoded.flow !== 'string' || typeof decoded.expiresAt !== 'string') {
        return null;
      }
      if (Date.parse(decoded.expiresAt) <= Date.now()) {
        return null;
      }
      return {
        challenge: decoded.challenge,
        flow: decoded.flow === 'register' ? 'register' : 'login',
        userId: typeof decoded.userId === 'string' ? decoded.userId : null,
        expiresAt: decoded.expiresAt
      };
    } catch {
      return null;
    }
  };

  const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff === 0;
  };

  // Minimal CBOR decoder (handles types needed for COSE keys)
  const decodeCbor = (data: Uint8Array): any => {
    let offset = 0;

    const readByte = (): number => {
      if (offset >= data.length) throw new Error('CBOR: unexpected end of data');
      return data[offset++];
    };

    const readBytes = (n: number): Uint8Array => {
      if (offset + n > data.length) throw new Error('CBOR: unexpected end of data');
      const slice = data.slice(offset, offset + n);
      offset += n;
      return slice;
    };

    const decodeUint = (initialByte: number): number => {
      const arg = initialByte & 0x1f;
      if (arg < 24) return arg;
      if (arg === 24) return readByte();
      if (arg === 25) {
        const b0 = readByte(), b1 = readByte();
        return (b0 << 8) | b1;
      }
      if (arg === 26) {
        const b0 = readByte(), b1 = readByte(), b2 = readByte(), b3 = readByte();
        return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
      }
      throw new Error('CBOR: unsupported uint size');
    };

    const decode = (): any => {
      const initialByte = readByte();
      const major = initialByte >> 5;
      const arg = initialByte & 0x1f;

      switch (major) {
        case 0: return decodeUint(initialByte);
        case 1: return -1 - decodeUint(initialByte);
        case 2: { // byte string
          const length = decodeUint(initialByte);
          return readBytes(length);
        }
        case 3: { // text string
          const length = decodeUint(initialByte);
          const bytes = readBytes(length);
          return new TextDecoder().decode(bytes);
        }
        case 4: { // array
          const length = decodeUint(initialByte);
          const arr: any[] = [];
          for (let i = 0; i < length; i++) arr.push(decode());
          return arr;
        }
        case 5: { // map
          const length = decodeUint(initialByte);
          const map: Record<number | string, any> = {};
          for (let i = 0; i < length; i++) {
            const key = decode();
            const value = decode();
            map[key] = value;
          }
          return map;
        }
        case 7: { // simple/float
          if (arg === 20) return false;
          if (arg === 21) return true;
          if (arg === 22) return null;
          if (arg === 23) return undefined;
          if (arg === 25) {
            // half-float
            const b0 = readByte(), b1 = readByte();
            const mantissa = b1 | ((b0 & 0x03) << 8);
            const exponent = (b0 >> 2) & 0x1f;
            const sign = b0 & 0x80 ? -1 : 1;
            if (exponent === 0) return sign * (mantissa / 1024) * Math.pow(2, -14);
            if (exponent === 31) return mantissa ? NaN : sign * Infinity;
            return sign * (1 + mantissa / 1024) * Math.pow(2, exponent - 15);
          }
          if (arg === 26) {
            const b0 = readByte(), b1 = readByte(), b2 = readByte(), b3 = readByte();
            const view = new DataView(new Uint8Array([b0, b1, b2, b3]).buffer);
            return view.getFloat32(0);
          }
          if (arg === 27) {
            const b0 = readByte(), b1 = readByte(), b2 = readByte(), b3 = readByte();
            const b4 = readByte(), b5 = readByte(), b6 = readByte(), b7 = readByte();
            const view = new DataView(new Uint8Array([b0, b1, b2, b3, b4, b5, b6, b7]).buffer);
            return view.getFloat64(0);
          }
          throw new Error(`CBOR: unsupported simple value ${arg}`);
        }
        default:
          throw new Error(`CBOR: unsupported major type ${major}`);
      }
    };

    return decode();
  };

  const decodePasskeyClientData = (clientDataJson: string): PasskeyClientData | null => {
    try {
      const rawBytes = fromBase64Url(clientDataJson);
      const json = new TextDecoder().decode(rawBytes);
      const parsed = JSON.parse(json);
      if (typeof parsed.type === 'string' && typeof parsed.challenge === 'string' && typeof parsed.origin === 'string') {
        return { type: parsed.type, challenge: parsed.challenge, origin: parsed.origin, rawBytes };
      }
    } catch {
      // try parsing directly as JSON string
      try {
        const parsed = JSON.parse(clientDataJson);
        if (typeof parsed.type === 'string' && typeof parsed.challenge === 'string' && typeof parsed.origin === 'string') {
          return {
            type: parsed.type,
            challenge: parsed.challenge,
            origin: parsed.origin,
            rawBytes: textEncoder.encode(clientDataJson)
          };
        }
      } catch {
        // ignored
      }
    }
    return null;
  };

  const parseAuthDataFlags = (authenticatorData: string): number => {
    const bytes = fromBase64Url(authenticatorData);
    if (bytes.length < 33) return 0;
    return bytes[32];
  };

  const parseAuthDataCounter = (authenticatorData: string): number => {
    const bytes = fromBase64Url(authenticatorData);
    if (bytes.length < 37) return 0;
    return (bytes[33] << 24) | (bytes[34] << 16) | (bytes[35] << 8) | bytes[36];
  };

  const parseAuthDataRpIdHash = (authenticatorData: string): Uint8Array => {
    const bytes = fromBase64Url(authenticatorData);
    return bytes.slice(0, 32);
  };

  const encodePasskeyUserHandle = (userId: string): string => (
    toBase64Url(textEncoder.encode(userId))
  );

  const matchesPasskeyUserHandle = (userHandle: string, expectedUserId: string): boolean => {
    try {
      return bytesEqual(fromBase64Url(userHandle), textEncoder.encode(expectedUserId));
    } catch {
      return false;
    }
  };

  type ParsedAuthData = {
    rpIdHash: Uint8Array;
    flags: number;
    counter: number;
    credentialIdLength: number;
    credentialId: Uint8Array;
    credentialPublicKey: Uint8Array;
  };

  const parseAuthData = (authenticatorData: string): ParsedAuthData | null => {
    try {
      const bytes = fromBase64Url(authenticatorData);
      if (bytes.length < 37) return null;
      const rpIdHash = bytes.slice(0, 32);
      const flags = bytes[32];
      const counter = (bytes[33] << 24) | (bytes[34] << 16) | (bytes[35] << 8) | bytes[36];

      let offset = 37;
      let credentialId: Uint8Array | null = null;
      let credentialIdLength = 0;
      let credentialPublicKey: Uint8Array | null = null;

      if (flags & 0x40) { // attested credential data
        if (offset + 18 > bytes.length) return null;
        // aaguid (16) + credentialIdLength (2)
        credentialIdLength = (bytes[offset + 16] << 8) | bytes[offset + 17];
        offset += 18;
        if (offset + credentialIdLength > bytes.length) return null;
        credentialId = bytes.slice(offset, offset + credentialIdLength);
        offset += credentialIdLength;
        // Remaining bytes are the credential public key (CBOR)
        credentialPublicKey = bytes.slice(offset);
      }

      return { rpIdHash, flags, counter, credentialIdLength, credentialId: credentialId || new Uint8Array(0), credentialPublicKey: credentialPublicKey || new Uint8Array(0) };
    } catch {
      return null;
    }
  };

  type ParsedAttestation = {
    authData: ParsedAuthData;
  };

  const parseAttestationObject = (attestationObject: string): ParsedAttestation | null => {
    try {
      const bytes = fromBase64Url(attestationObject);
      const decoded = decodeCbor(bytes);
      if (!decoded || typeof decoded !== 'object') return null;
      const authDataRaw = decoded.authBuf || decoded.authData;
      if (!authDataRaw || !(authDataRaw instanceof Uint8Array)) return null;

      const authDataBase64 = toBase64Url(authDataRaw);
      const authData = parseAuthData(authDataBase64);
      if (!authData) return null;

      return { authData };
    } catch {
      return null;
    }
  };

  type CoseKeyInfo = {
    kty: number;
    alg: number;
    crv: number;
    x: Uint8Array;
    y?: Uint8Array;
    n?: Uint8Array;
    e?: Uint8Array;
    curve: string;
  };

  const parseCosePublicKey = (data: Uint8Array): CoseKeyInfo | null => {
    try {
      const decoded = decodeCbor(data);
      if (!decoded || typeof decoded !== 'object') return null;

      const kty = Number(decoded[1]);
      const alg = Number(decoded[3]);

      if (kty === 2) { // EC2
        const crv = Number(decoded[-1]);
        const x = decoded[-2];
        const y = decoded[-3];
        if (!(x instanceof Uint8Array)) return null;

        let curve = 'P-256';
        if (crv === 1) curve = 'P-256';
        else if (crv === 2) curve = 'P-384';
        else if (crv === 3) curve = 'P-521';

        return { kty, alg, crv, x, y: y instanceof Uint8Array ? y : undefined, curve };
      }

      if (kty === 3) { // RSA
        const n = decoded[-1];
        const e = decoded[-2];
        if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) return null;
        return { kty, alg, crv: 0, x: new Uint8Array(0), n, e, curve: 'RSA' };
      }

      if (kty === 4) { // OKP (Ed25519)
        const crv = Number(decoded[-1]);
        const x = decoded[-2];
        if (!(x instanceof Uint8Array)) return null;
        return { kty, alg, crv, x, curve: crv === 6 ? 'Ed25519' : 'unknown' };
      }

      return null;
    } catch {
      return null;
    }
  };

  const coseKeyToCryptoKey = async (coseKey: CoseKeyInfo): Promise<CryptoKey | null> => {
    try {
      if (coseKey.kty === 2) { // EC2
        if (coseKey.y) {
          const namedCurve = coseKey.curve === 'P-384' ? 'P-384' : 'P-256';
          return crypto.subtle.importKey(
            'jwk',
            {
              kty: 'EC',
              crv: namedCurve,
              x: toBase64Url(coseKey.x),
              y: toBase64Url(coseKey.y),
              ext: true
            },
            { name: 'ECDSA', namedCurve },
            true,
            ['verify']
          );
        }
      }

      if (coseKey.kty === 3 && coseKey.n && coseKey.e) { // RSA
        const jwk: JsonWebKey = {
          kty: 'RSA',
          alg: coseKey.alg === -257 ? 'RS256' : 'PS256',
          n: toBase64Url(coseKey.n),
          e: toBase64Url(coseKey.e),
          ext: true
        };
        return crypto.subtle.importKey(
          'jwk',
          jwk,
          coseKey.alg === -257
            ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
            : { name: 'RSA-PSS', hash: 'SHA-256' },
          true,
          ['verify']
        );
      }

      return null;
    } catch {
      return null;
    }
  };
  app.get('/api/auth/setup', async (c) => {
    const ready = await hasUsableEmailAccount(c.env.DB);
    return c.json({ requires_setup: !ready });
  });

  app.post('/api/auth/setup', async (c) => {
    const productionSecretError = requireProductionSecret(c, 'ADMIN_SETUP_TOKEN', 'initial admin setup');
    if (productionSecretError) {
      return productionSecretError;
    }

    const configuredToken = c.env.ADMIN_SETUP_TOKEN?.trim() || '';
    const requestToken = (c.req.header('x-setup-token') || '').trim();
    if (configuredToken && requestToken !== configuredToken) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const userSchema = await getUserSchemaSupport(c.env.DB);
    const ready = await hasUsableEmailAccount(c.env.DB);
    if (ready) {
      return c.json({ error: 'Admin already exists' }, 409);
    }

    const body = await c.req.json();
    const password = typeof (body as any)?.password === 'string' ? (body as any).password : '';
    const email = normalizeEmail((body as any)?.email ?? (body as any)?.username);
    if (!email || !password) {
      return c.json({ error: 'email and password are required' }, 400);
    }
    if (!isValidEmail(email)) {
      return c.json({ error: 'Invalid email format' }, 400);
    }
    const passwordValidationError = validatePasswordStrength(password, [email]);
    if (passwordValidationError) {
      return c.json({ error: passwordValidationError }, 400);
    }

    const id = crypto.randomUUID();
    const salt = randomBase64(16);
    const passwordHash = await hashPassword(password, salt);
    const now = new Date().toISOString();

    const columns = ['id', 'username', 'password_hash', 'password_salt', 'role', 'created_at', 'updated_at'];
    const values: Array<string | null> = [id, email, passwordHash, salt, 'admin', now, now];
    if (userSchema.hasEmail) {
      columns.push('email');
      values.push(email);
    }
    if (userSchema.hasEmailVerifiedAt) {
      columns.push('email_verified_at');
      values.push(now);
    }
    await c.env.DB.prepare(
      `INSERT INTO users (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...values).run();

    notifyUpdate(c, 'user:setup', {
      id,
      username: email,
      role: 'admin'
    });
    await recordAuditLog(c, {
      action: 'setup',
      resourceType: 'users',
      resourceId: id,
      summary: `初始化管理員帳號 ${email}`,
      details: {
        username: email,
        role: 'admin'
      }
    });
    return c.json({ id, username: email, email }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const userSchema = await getUserSchemaSupport(c.env.DB);
    const body = await c.req.json();
    const password = typeof (body as any)?.password === 'string' ? (body as any).password : '';
    const email = normalizeEmail((body as any)?.email ?? (body as any)?.username);
    if (!email || !password) {
      return c.json({ error: 'email and password are required' }, 400);
    }
    if (!isValidEmail(email)) {
      return c.json({ error: 'Invalid email format' }, 400);
    }

    const loginIp = getRequestIpAddress(c) || 'unknown-ip';
    const accountRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'login_account',
      limiterKey: email,
      windowMs: ACCOUNT_LOGIN_RATE_LIMIT.windowMs,
      maxAttempts: ACCOUNT_LOGIN_RATE_LIMIT.maxAttempts,
      blockMs: ACCOUNT_LOGIN_RATE_LIMIT.blockMs
    });
    if (!accountRateLimit.allowed) {
      c.header('Retry-After', String(accountRateLimit.retryAfterSeconds));
      await recordLoginAttempt(c, {
        email,
        success: false,
        reason: 'account_rate_limited'
      });
      await recordRateLimitAudit(c, {
        action: 'login_account',
        limiterKey: email,
        route: '/api/auth/login',
        retryAfterSeconds: accountRateLimit.retryAfterSeconds,
        summary: `登入帳號速率限制：${email}`
      });
      return c.json({ error: 'Too many login attempts. Please try again later.' }, 429);
    }

    const loginRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'login',
      limiterKey: `${loginIp}:${email}`,
      windowMs: LOGIN_RATE_LIMIT.windowMs,
      maxAttempts: LOGIN_RATE_LIMIT.maxAttempts,
      blockMs: LOGIN_RATE_LIMIT.blockMs
    });
    if (!loginRateLimit.allowed) {
      c.header('Retry-After', String(loginRateLimit.retryAfterSeconds));
      await recordLoginAttempt(c, {
        email,
        success: false,
        reason: 'ip_rate_limited'
      });
      await recordRateLimitAudit(c, {
        action: 'login',
        limiterKey: `${loginIp}:${email}`,
        route: '/api/auth/login',
        retryAfterSeconds: loginRateLimit.retryAfterSeconds,
        summary: `登入 IP 速率限制：${email}`
      });
      return c.json({ error: 'Too many login attempts. Please try again later.' }, 429);
    }

    const loginField = userSchema.hasEmail ? 'email' : 'username';
    const verifyField = userSchema.hasEmailVerifiedAt ? ', email_verified_at' : '';
    const totpField = userSchema.hasMfaTotpSecret ? ', mfa_totp_secret' : '';
    const user = await c.env.DB.prepare(
      `SELECT id, username, password_hash, password_salt, role${verifyField}${totpField},
              EXISTS(SELECT 1 FROM sessions s WHERE s.user_id = users.id LIMIT 1) AS has_logged_in_before
       FROM users
       WHERE ${loginField} = ?`
    ).bind(email).first();
    if (!user) {
      await hashPassword(password, 'dummy-salt-value-for-timing-attack-mitigation');
      await recordLoginAttempt(c, {
        email,
        success: false,
        reason: 'invalid_credentials'
      });
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    if (userSchema.hasEmailVerifiedAt && !(user as any).email_verified_at) {
      await hashPassword(password, 'dummy-salt-value-for-timing-attack-mitigation');
      await recordLoginAttempt(c, {
        email,
        success: false,
        reason: 'email_not_verified',
        userId: (user as any).id as string,
        role: normalizeRole((user as any).role)
      });
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    const salt = (user as any).password_salt as string;
    const expectedHash = (user as any).password_hash as string;
    const actualHash = await hashPassword(password, salt);
    if (!timingSafeEqual(actualHash, expectedHash)) {
      await recordLoginAttempt(c, {
        email,
        success: false,
        reason: 'invalid_credentials',
        userId: (user as any).id as string,
        role: normalizeRole((user as any).role)
      });
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    const userRole = normalizeRole((user as any).role);
    const totpEnabled = Boolean(userSchema.hasMfaTotpSecret && (user as any).mfa_totp_secret);
    const hasLoggedInBefore = Boolean((user as any).has_logged_in_before);

    // Check if user has passkeys registered
    let hasPasskeys = false;
    try {
      await ensurePasskeysTable(c.env.DB);
      const passkeyCheck = await c.env.DB.prepare(
        'SELECT 1 FROM auth_passkeys WHERE user_id = ? LIMIT 1'
      ).bind((user as any).id as string).first();
      hasPasskeys = Boolean(passkeyCheck);
    } catch {
      // passkeys table may not exist yet
    }

    if (userRole === 'admin' && !totpEnabled && !hasPasskeys && hasLoggedInBefore) {
      await recordLoginAttempt(c, {
        email,
        success: false,
        reason: 'admin_totp_required',
        userId: (user as any).id as string,
        role: userRole
      });
      return c.json({ error: 'Admin accounts require authenticator app MFA. Sign in from an existing admin session and enable TOTP first.' }, 403);
    }

    const mfaSession = await createMfaSession(c, {
      userId: (user as any).id as string,
      email
    });
    let emailChallengeId: string | null = null;
    let emailDelivered: boolean | null = null;
    let debugMfaCode: string | null = null;

    if (!totpEnabled) {
      const emailFallback = await issueEmailFallbackChallenge(c, {
        userId: (user as any).id as string,
        email,
        role: userRole
      });
      if (!emailFallback.ok) {
        if (emailFallback.retryAfterSeconds) {
          c.header('Retry-After', String(emailFallback.retryAfterSeconds));
          await recordLoginAttempt(c, {
            email,
            success: false,
            reason: 'mfa_send_rate_limited',
            userId: (user as any).id as string,
            role: userRole
          });
          await recordRateLimitAudit(c, {
            action: 'login_mfa_send',
            limiterKey: email,
            route: '/api/auth/login',
            retryAfterSeconds: emailFallback.retryAfterSeconds,
            summary: `登入 MFA 寄送速率限制：${email}`
          });
          return c.json({ error: 'Too many sign-in code requests. Please try again later.' }, 429);
        }
        return c.json({ error: 'Unable to deliver sign-in code. Please try again later.' }, 503);
      }
      emailChallengeId = emailFallback.challenge.challengeId;
      emailDelivered = emailFallback.challenge.delivered;
      debugMfaCode = c.env.ENVIRONMENT === 'production' ? null : emailFallback.challenge.code;
    }

    return c.json({
      mfa_required: true,
      session_id: mfaSession.sessionId,
      email,
      masked_email: maskEmail(email),
      methods: totpEnabled
        ? (userRole === 'admin' ? (hasPasskeys ? ['totp', 'passkey'] : ['totp']) : (hasPasskeys ? ['totp', 'email', 'passkey'] : ['totp', 'email']))
        : (hasPasskeys ? ['email', 'passkey'] : ['email']),
      preferred_method: totpEnabled ? 'totp' : 'email',
      passkey_available: hasPasskeys,
      email_challenge_id: emailChallengeId,
      delivered: emailDelivered,
      ...(debugMfaCode ? { debug_mfa_code: debugMfaCode } : {})
    }, 202);
  });

  app.post('/api/auth/mfa/send-email', async (c) => {
    await ensureAuthMfaSessionTable(c.env.DB);

    const body = await c.req.json();
    const sessionId = normalizeIdentifier((body as any)?.session_id);
    if (!sessionId) {
      return c.json({ error: 'session_id is required' }, 400);
    }

    const mfaSession = await getMfaSession(c.env.DB, sessionId);
    if (!mfaSession) {
      return c.json({ error: 'Invalid or expired MFA session' }, 400);
    }

    const nowIso = new Date().toISOString();
    if (((mfaSession as any).expires_at as string) <= nowIso) {
      await c.env.DB.prepare('DELETE FROM auth_mfa_sessions WHERE id = ?').bind(sessionId).run();
      return c.json({ error: 'Invalid or expired MFA session' }, 400);
    }

    const user = await c.env.DB.prepare(
      'SELECT id, role FROM users WHERE id = ?'
    ).bind((mfaSession as any).user_id as string).first();
    if (!user) {
      return c.json({ error: 'Invalid or expired MFA session' }, 400);
    }
    if (normalizeRole((user as any).role) === 'admin') {
      return c.json({ error: 'Admin accounts must use authenticator app MFA.' }, 403);
    }

    const emailFallback = await issueEmailFallbackChallenge(c, {
      userId: (mfaSession as any).user_id as string,
      email: (mfaSession as any).email as string,
      role: normalizeRole((user as any).role)
    });
    if (!emailFallback.ok) {
      if (emailFallback.retryAfterSeconds) {
        c.header('Retry-After', String(emailFallback.retryAfterSeconds));
        await recordRateLimitAudit(c, {
          action: 'login_mfa_send',
          limiterKey: String((mfaSession as any).email as string),
          route: '/api/auth/mfa/send-email',
          retryAfterSeconds: emailFallback.retryAfterSeconds,
          summary: `MFA 驗證碼寄送速率限制：${String((mfaSession as any).email as string)}`
        });
        return c.json({ error: 'Too many sign-in code requests. Please try again later.' }, 429);
      }
      return c.json({ error: 'Unable to deliver sign-in code. Please try again later.' }, 503);
    }

    return c.json({
      ok: true,
      challenge_id: emailFallback.challenge.challengeId,
      delivered: emailFallback.challenge.delivered,
      ...(c.env.ENVIRONMENT === 'production' ? {} : { debug_mfa_code: emailFallback.challenge.code })
    });
  });

  app.post('/api/auth/mfa/verify-totp', async (c) => {
    const productionSecretError = requireProductionSecret(c, 'AUTH_ENCRYPTION_KEY', 'TOTP verification');
    if (productionSecretError) {
      return productionSecretError;
    }

    await ensureAuthMfaSessionTable(c.env.DB);
    const userSchema = await getUserSchemaSupport(c.env.DB);

    const body = await c.req.json();
    const sessionId = normalizeIdentifier((body as any)?.session_id);
    const code = normalizeOtpCode((body as any)?.code);
    if (!sessionId || !code) {
      return c.json({ error: 'session_id and code are required' }, 400);
    }

    const currentIp = getRequestIpAddress(c) || 'unknown-ip';
    const mfaVerifyRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'mfa_verify',
      limiterKey: currentIp,
      ...MFA_VERIFY_RATE_LIMIT
    });
    if (!mfaVerifyRateLimit.allowed) {
      c.header('Retry-After', String(mfaVerifyRateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'mfa_verify',
        limiterKey: currentIp,
        route: '/api/auth/mfa/verify-totp',
        retryAfterSeconds: mfaVerifyRateLimit.retryAfterSeconds,
        summary: `TOTP 驗證速率限制：${currentIp}`
      });
      return c.json({ error: 'Too many verification attempts' }, 429);
    }

    const mfaSession = await getMfaSession(c.env.DB, sessionId);
    if (!mfaSession) {
      return c.json({ error: 'Invalid or expired MFA session' }, 400);
    }

    const nowIso = new Date().toISOString();
    if (((mfaSession as any).expires_at as string) <= nowIso) {
      await c.env.DB.prepare('DELETE FROM auth_mfa_sessions WHERE id = ?').bind(sessionId).run();
      return c.json({ error: 'Invalid or expired MFA session' }, 400);
    }

    const attemptCount = Number((mfaSession as any).attempt_count ?? 0);
    const maxAttempts = Number((mfaSession as any).max_attempts ?? MFA_MAX_ATTEMPTS);
    if (attemptCount >= maxAttempts) {
      await c.env.DB.prepare('DELETE FROM auth_mfa_sessions WHERE id = ?').bind(sessionId).run();
      return c.json({ error: 'Invalid or expired MFA session' }, 400);
    }

    const totpField = userSchema.hasMfaTotpSecret ? ', mfa_totp_secret' : '';
    const user = await c.env.DB.prepare(
      `SELECT id, username, role${totpField} FROM users WHERE id = ?`
    ).bind((mfaSession as any).user_id as string).first();
    if (!user || !userSchema.hasMfaTotpSecret || !(user as any).mfa_totp_secret) {
      return c.json({ error: 'Authenticator app MFA is not enabled' }, 400);
    }

    const totpSecret = await decryptSecret(c.env, (user as any).mfa_totp_secret as string | null);
    if (!totpSecret) {
      return c.json({ error: 'Authenticator app MFA is not enabled' }, 400);
    }

    const isValid = await verifyTotpCode(totpSecret, code);
    if (!isValid) {
      const nextAttempts = attemptCount + 1;
      if (nextAttempts >= maxAttempts) {
        await c.env.DB.prepare('DELETE FROM auth_mfa_sessions WHERE id = ?').bind(sessionId).run();
      } else {
        await c.env.DB.prepare(
          'UPDATE auth_mfa_sessions SET attempt_count = ? WHERE id = ?'
        ).bind(nextAttempts, sessionId).run();
      }
      await recordAuditLog(c, {
        action: 'mfa_failed',
        resourceType: 'auth',
        resourceId: (user as any).id as string,
        summary: `TOTP 驗證失敗 ${(mfaSession as any).email as string}`,
        details: {
          email: (mfaSession as any).email as string,
          session_id: sessionId,
          attempt_count: nextAttempts,
          ip_address: getRequestIpAddress(c),
          user_agent: getRequestUserAgent(c)
        }
      });
      return c.json({ error: 'Invalid or expired sign-in code' }, 401);
    }

    const consumedSession = await c.env.DB.prepare(
      `DELETE FROM auth_mfa_sessions
       WHERE id = ?
         AND expires_at > ?
         AND attempt_count < max_attempts
       RETURNING user_id, email`
    ).bind(sessionId, nowIso).first();
    if (!consumedSession) {
      return c.json({ error: 'Invalid or expired MFA session' }, 400);
    }

    const userRole = normalizeRole((user as any).role);
    await migrateStoredTotpSecretIfNeeded(
      c.env.DB,
      c.env,
      (user as any).id as string,
      (user as any).mfa_totp_secret as string | null
    );
    await createSession(c, {
      id: (user as any).id as string,
      username: (user as any).username as string,
      role: userRole
    });
    await clearRateLimit(c.env.DB, 'login', `${getRequestIpAddress(c) || 'unknown-ip'}:${(consumedSession as any).email as string}`);
    await clearRateLimit(c.env.DB, 'login_account', (consumedSession as any).email as string);
    await clearRateLimit(c.env.DB, 'login_mfa_send', (consumedSession as any).email as string);
    await recordAuditLog(c, {
      action: 'mfa_success',
      resourceType: 'auth',
      resourceId: (user as any).id as string,
      summary: `TOTP 驗證成功 ${(consumedSession as any).email as string}`,
      details: {
        email: (consumedSession as any).email as string,
        method: 'totp',
        ip_address: getRequestIpAddress(c),
        user_agent: getRequestUserAgent(c)
      }
    });
    await recordLoginAttempt(c, {
      email: (consumedSession as any).email as string,
      success: true,
      reason: 'authenticated',
      userId: (user as any).id as string,
      role: userRole
    });

    const accountData = await getAccountById(c.env.DB, (user as any).id as string);
    return c.json({
      user: accountData?.account ?? {
        id: (user as any).id,
        username: (user as any).username,
        email: (user as any).username,
        role: userRole,
        avatar_url: null
      }
    });
  });

  app.post('/api/auth/verify-mfa', async (c) => {
    await ensureAuthMfaTable(c.env.DB);
    await ensureAuthMfaSessionTable(c.env.DB);

    const body = await c.req.json();
    const challengeId = normalizeIdentifier((body as any)?.challenge_id);
    const code = normalizeOtpCode((body as any)?.code);
    if (!challengeId || !code) {
      return c.json({ error: 'challenge_id and code are required' }, 400);
    }

    const challenge = await c.env.DB.prepare(
      `SELECT id, user_id, email, code_hash, expires_at, attempt_count, max_attempts
       FROM auth_mfa_challenges
       WHERE id = ?`
    ).bind(challengeId).first();
    if (!challenge) {
      return c.json({ error: 'Invalid or expired sign-in code' }, 400);
    }

    const nowIso = new Date().toISOString();
    if (((challenge as any).expires_at as string) <= nowIso) {
      await c.env.DB.prepare('DELETE FROM auth_mfa_challenges WHERE id = ?').bind(challengeId).run();
      return c.json({ error: 'Invalid or expired sign-in code' }, 400);
    }

    const attemptCount = Number((challenge as any).attempt_count ?? 0);
    const maxAttempts = Number((challenge as any).max_attempts ?? MFA_MAX_ATTEMPTS);
    if (attemptCount >= maxAttempts) {
      await c.env.DB.prepare('DELETE FROM auth_mfa_challenges WHERE id = ?').bind(challengeId).run();
      return c.json({ error: 'Invalid or expired sign-in code' }, 400);
    }

    const codeHash = await sha256Base64(code);
    if (!timingSafeEqual(codeHash, (challenge as any).code_hash as string)) {
      const nextAttempts = attemptCount + 1;
      if (nextAttempts >= maxAttempts) {
        await c.env.DB.prepare('DELETE FROM auth_mfa_challenges WHERE id = ?').bind(challengeId).run();
      } else {
        await c.env.DB.prepare(
          'UPDATE auth_mfa_challenges SET attempt_count = ? WHERE id = ?'
        ).bind(nextAttempts, challengeId).run();
      }
      await recordAuditLog(c, {
        action: 'mfa_failed',
        resourceType: 'auth',
        resourceId: (challenge as any).user_id as string,
        summary: `MFA 驗證失敗 ${(challenge as any).email as string}`,
        details: {
          email: (challenge as any).email as string,
          challenge_id: challengeId,
          attempt_count: nextAttempts,
          ip_address: getRequestIpAddress(c),
          user_agent: getRequestUserAgent(c)
        }
      });
      return c.json({ error: 'Invalid or expired sign-in code' }, 401);
    }

    const consumedChallenge = await c.env.DB.prepare(
      `DELETE FROM auth_mfa_challenges
       WHERE id = ?
         AND code_hash = ?
         AND expires_at > ?
         AND attempt_count < max_attempts
       RETURNING user_id, email`
    ).bind(challengeId, codeHash, nowIso).first();
    if (!consumedChallenge) {
      return c.json({ error: 'Invalid or expired sign-in code' }, 400);
    }

    const user = await c.env.DB.prepare(
      'SELECT id, username, role FROM users WHERE id = ?'
    ).bind((consumedChallenge as any).user_id as string).first();
    if (!user) {
      return c.json({ error: 'Invalid or expired sign-in code' }, 400);
    }
    if (normalizeRole((user as any).role) === 'admin') {
      await c.env.DB.prepare('DELETE FROM auth_mfa_sessions WHERE user_id = ?').bind((consumedChallenge as any).user_id as string).run();
      return c.json({ error: 'Admin accounts must use authenticator app MFA.' }, 403);
    }

    const userRole = normalizeRole((user as any).role);
    await createSession(c, {
      id: (user as any).id as string,
      username: (user as any).username as string,
      role: userRole
    });
    await c.env.DB.prepare(
      'DELETE FROM auth_mfa_sessions WHERE user_id = ?'
    ).bind((consumedChallenge as any).user_id as string).run();
    await clearRateLimit(c.env.DB, 'login', `${getRequestIpAddress(c) || 'unknown-ip'}:${(consumedChallenge as any).email as string}`);
    await clearRateLimit(c.env.DB, 'login_account', (consumedChallenge as any).email as string);
    await clearRateLimit(c.env.DB, 'login_mfa_send', (consumedChallenge as any).email as string);

    await recordAuditLog(c, {
      action: 'mfa_success',
      resourceType: 'auth',
      resourceId: (user as any).id as string,
      summary: `MFA 驗證成功 ${(consumedChallenge as any).email as string}`,
      details: {
        email: (consumedChallenge as any).email as string,
        method: 'email',
        ip_address: getRequestIpAddress(c),
        user_agent: getRequestUserAgent(c)
      }
    });
    await recordLoginAttempt(c, {
      email: (consumedChallenge as any).email as string,
      success: true,
      reason: 'authenticated',
      userId: (user as any).id as string,
      role: userRole
    });

    const accountData = await getAccountById(c.env.DB, (user as any).id as string);
    return c.json({
      user: accountData?.account ?? {
        id: (user as any).id,
        username: (user as any).username,
        email: (user as any).username,
        role: userRole,
        avatar_url: null
      }
    });
  });

  app.post('/api/auth/verify-email', async (c) => {
    const userSchema = await getUserSchemaSupport(c.env.DB);
    if (!userSchema.hasEmail || !userSchema.hasEmailVerifiedAt || !userSchema.hasEmailVerifyTokenHash || !userSchema.hasEmailVerifyExpiresAt) {
      return c.json({ error: 'Email verification is not available' }, 503);
    }

    const body = await c.req.json();
    const token = normalizeIdentifier((body as any)?.token);
    if (!token) {
      return c.json({ error: 'token is required' }, 400);
    }

    const tokenHash = await sha256Base64(token);
    const now = new Date().toISOString();
    const user = await c.env.DB.prepare(
      `SELECT id, email
       FROM users
       WHERE email_verify_token_hash = ?
         AND email_verify_expires_at IS NOT NULL
         AND email_verify_expires_at > ?`
    ).bind(tokenHash, now).first();
    if (!user) {
      return c.json({ error: 'Invalid or expired token' }, 400);
    }

    await c.env.DB.prepare(
      `UPDATE users
       SET email_verified_at = ?, email_verify_token_hash = NULL, email_verify_expires_at = NULL, updated_at = ?
       WHERE id = ?`
    ).bind(now, now, (user as any).id as string).run();

    await recordAuditLog(c, {
      action: 'verify_email',
      resourceType: 'users',
      resourceId: (user as any).id as string,
      summary: `驗證 Email ${(user as any).email as string}`,
      details: {
        email: (user as any).email as string
      }
    });

    return c.json({ ok: true, email: (user as any).email as string });
  });

  app.post('/api/auth/accept-invite', async (c) => {
    const userSchema = await getUserSchemaSupport(c.env.DB);
    if (!userSchema.hasEmail || !userSchema.hasEmailVerifiedAt || !userSchema.hasEmailVerifyTokenHash || !userSchema.hasEmailVerifyExpiresAt) {
      return c.json({ error: 'Invitations are not available' }, 503);
    }

    const body = await c.req.json();
    const token = normalizeIdentifier((body as any)?.token);
    const password = typeof (body as any)?.password === 'string' ? (body as any).password : '';
    if (!token || !password) {
      return c.json({ error: 'token and password are required' }, 400);
    }

    const tokenHash = await sha256Base64(token);
    const now = new Date().toISOString();
    const user = await c.env.DB.prepare(
      `SELECT id, email, password_hash, password_salt
       FROM users
       WHERE email_verify_token_hash = ?
         AND email_verify_expires_at IS NOT NULL
         AND email_verify_expires_at > ?`
    ).bind(tokenHash, now).first();
    if (!user) {
      return c.json({ error: 'Invalid or expired invite token' }, 400);
    }
    if (!isInvitePendingPassword((user as any).password_hash, (user as any).password_salt)) {
      return c.json({ error: 'This invitation has already been accepted' }, 409);
    }

    const email = (user as any).email as string;
    const passwordValidationError = validatePasswordStrength(password, [email]);
    if (passwordValidationError) {
      return c.json({ error: passwordValidationError }, 400);
    }

    const salt = randomBase64(16);
    const passwordHash = await hashPassword(password, salt);
    await c.env.DB.prepare(
      `UPDATE users
       SET password_hash = ?, password_salt = ?, email_verified_at = ?, email_verify_token_hash = NULL, email_verify_expires_at = NULL, updated_at = ?
       WHERE id = ?`
    ).bind(passwordHash, salt, now, now, (user as any).id as string).run();

    await recordAuditLog(c, {
      action: 'accept_invite',
      resourceType: 'users',
      resourceId: (user as any).id as string,
      summary: `接受邀請 ${email}`,
      details: {
        email
      }
    });

    return c.json({ ok: true, email });
  });

  app.post('/api/auth/resend-verification', async (c) => {
    const userSchema = await getUserSchemaSupport(c.env.DB);
    if (!userSchema.hasEmail || !userSchema.hasEmailVerifiedAt || !userSchema.hasEmailVerifyTokenHash || !userSchema.hasEmailVerifyExpiresAt) {
      return c.json({ ok: true });
    }

    const body = await c.req.json();
    const email = normalizeEmail((body as any)?.email);
    if (!email || !isValidEmail(email)) {
      return c.json({ ok: true });
    }

    const resendIp = getRequestIpAddress(c) || 'unknown-ip';
    const resendRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'resend_verification',
      limiterKey: `${resendIp}:${email}`,
      windowMs: RESEND_RATE_LIMIT.windowMs,
      maxAttempts: RESEND_RATE_LIMIT.maxAttempts,
      blockMs: RESEND_RATE_LIMIT.blockMs
    });
    if (!resendRateLimit.allowed) {
      c.header('Retry-After', String(resendRateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'resend_verification',
        limiterKey: `${resendIp}:${email}`,
        route: '/api/auth/resend-verification',
        retryAfterSeconds: resendRateLimit.retryAfterSeconds,
        summary: `重寄驗證信速率限制：${email}`
      });
      return c.json({ error: 'Too many resend requests. Please try again later.' }, 429);
    }

    const user = await c.env.DB.prepare(
      'SELECT id, email, email_verified_at, password_hash, password_salt FROM users WHERE email = ?'
    ).bind(email).first();
    if (!user || (user as any).email_verified_at) {
      return c.json({ ok: true });
    }

    const { token, tokenHash, expiresAt } = await createVerificationToken();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE users
       SET email_verify_token_hash = ?, email_verify_expires_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(tokenHash, expiresAt, now, (user as any).id as string).run();

    const invitePending = isInvitePendingPassword((user as any).password_hash, (user as any).password_salt);
    const actionUrl = invitePending ? buildInvitationUrl(c.env, token) : buildVerificationUrl(c.env, token);
    const delivered = invitePending
      ? await sendInvitationEmail(c.env, email, actionUrl)
      : await sendVerificationEmail(c.env, email, actionUrl);

    await recordAuditLog(c, {
      action: invitePending ? 'resend_invite' : 'resend_verification',
      resourceType: 'users',
      resourceId: (user as any).id as string,
      summary: invitePending ? `重送邀請信 ${email}` : `重送 Email 驗證信 ${email}`,
      details: {
        email,
        delivered,
        invite_pending: invitePending
      }
    });

    const debugToken = c.env.ENVIRONMENT === 'production' ? null : token;
    return c.json({
      ok: true,
      delivered,
      ...(invitePending
        ? (debugToken ? { debug_invite_token: debugToken } : {})
        : (debugToken ? { debug_verify_token: debugToken } : {}))
    });
  });

  app.post('/api/auth/forgot-password', async (c) => {
    const body = await c.req.json();
    const email = normalizeEmail((body as any)?.email);
    const responsePayload = { ok: true };
    if (!email || !isValidEmail(email)) {
      return c.json(responsePayload);
    }

    const forgotIp = getRequestIpAddress(c) || 'unknown-ip';
    const forgotRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'forgot_password',
      limiterKey: `${forgotIp}:${email}`,
      ...FORGOT_PASSWORD_RATE_LIMIT
    });
    if (!forgotRateLimit.allowed) {
      return c.json(responsePayload);
    }

    const userSchema = await getUserSchemaSupport(c.env.DB);
    await ensurePasswordResetTokenTable(c.env.DB);
    const nowIso = new Date().toISOString();
    await c.env.DB.prepare(
      'DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL'
    ).bind(nowIso).run();

    const field = userSchema.hasEmail ? 'email' : 'username';
    const user = await c.env.DB.prepare(
      `SELECT id, username${userSchema.hasEmail ? ', email' : ''} FROM users WHERE ${field} = ?`
    ).bind(email).first();
    if (!user) {
      await hashPassword('dummy', 'dummy-salt-value-for-timing-attack-mitigation');
      return c.json(responsePayload);
    }

    const token = await createPasswordResetToken();
    await c.env.DB.prepare(
      'DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL'
    ).bind((user as any).id as string).run();
    await c.env.DB.prepare(
      `INSERT INTO password_reset_tokens (
        id, user_id, token_hash, requested_ip, requested_user_agent, expires_at, used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
    ).bind(
      crypto.randomUUID(),
      (user as any).id as string,
      token.tokenHash,
      getRequestIpAddress(c),
      getRequestUserAgent(c),
      token.expiresAt,
      nowIso
    ).run();

    const destinationEmail = (userSchema.hasEmail
      ? ((user as any).email as string | null)
      : ((user as any).username as string | null)) || email;
    if (isValidEmail(destinationEmail)) {
      await sendPasswordResetEmail(c.env, destinationEmail, buildPasswordResetUrl(c.env, token.token));
    }

    return c.json(responsePayload);
  });

  app.post('/api/auth/reset-password', async (c) => {
    await ensurePasswordResetTokenTable(c.env.DB);
    const body = await c.req.json();
    const token = normalizeIdentifier((body as any)?.token);
    const password = typeof (body as any)?.password === 'string' ? (body as any).password : '';
    if (!token || !password) {
      return c.json({ error: 'token and password are required' }, 400);
    }

    const tokenHash = await sha256Base64(token);
    const nowIso = new Date().toISOString();
    await c.env.DB.prepare(
      'DELETE FROM password_reset_tokens WHERE expires_at <= ?'
    ).bind(nowIso).run();

    const row = await c.env.DB.prepare(
      `SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at,
              u.username, u.password_hash, u.password_salt${(await getUserSchemaSupport(c.env.DB)).hasEmail ? ', u.email' : ''}
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = ?
       LIMIT 1`
    ).bind(tokenHash).first();
    if (!row || ((row as any).used_at as string | null) || ((row as any).expires_at as string) <= nowIso) {
      return c.json({ error: 'Invalid or expired reset token' }, 400);
    }

    const compareEmail = ((row as any).email as string | null) ?? ((row as any).username as string);
    const passwordValidationError = validatePasswordStrength(password, [compareEmail]);
    if (passwordValidationError) {
      return c.json({ error: passwordValidationError }, 400);
    }

    const salt = randomBase64(16);
    const passwordHash = await hashPassword(password, salt);
    await c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?'
    ).bind(passwordHash, salt, nowIso, (row as any).user_id as string).run();
    await c.env.DB.prepare(
      'UPDATE password_reset_tokens SET used_at = ? WHERE id = ?'
    ).bind(nowIso, (row as any).id as string).run();
    await c.env.DB.prepare(
      'DELETE FROM password_reset_tokens WHERE user_id = ? AND id != ?'
    ).bind((row as any).user_id as string, (row as any).id as string).run();
    const revokedSessions = await revokeUserSessions(c.env.DB, (row as any).user_id as string, null);
    if (isValidEmail(compareEmail)) {
      await sendPasswordChangedEmail(c.env, compareEmail);
    }

    await recordAuditLog(c, {
      action: 'reset_password',
      resourceType: 'account',
      resourceId: (row as any).user_id as string,
      summary: `重設密碼 ${compareEmail}`,
      details: {
        revoked_sessions: revokedSessions
      }
    });

    return c.json({ ok: true });
  });

  app.get('/api/auth/mfa/status', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const userSchema = await getUserSchemaSupport(c.env.DB);
    const fields = ['id', 'username'];
    if (userSchema.hasEmail) fields.push('email');
    if (userSchema.hasMfaTotpSecret) fields.push('mfa_totp_secret');
    if (userSchema.hasMfaTotpEnabledAt) fields.push('mfa_totp_enabled_at');
    if (userSchema.hasMfaTotpPendingExpiresAt) fields.push('mfa_totp_pending_expires_at');
    const user = await c.env.DB.prepare(
      `SELECT ${fields.join(', ')} FROM users WHERE id = ?`
    ).bind(sessionUser.userId).first();
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const email = ((user as any).email as string | null) ?? ((user as any).username as string);

    // Check passkey count
    let passkeyCount = 0;
    try {
      await ensurePasskeysTable(c.env.DB);
      const passkeyResult = await c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM auth_passkeys WHERE user_id = ?'
      ).bind(sessionUser.userId).first();
      passkeyCount = Number((passkeyResult as any)?.count ?? 0);
    } catch {
      // passkeys table may not exist yet
    }

    return c.json({
      totp_enabled: Boolean(userSchema.hasMfaTotpSecret && (user as any).mfa_totp_secret),
      totp_enabled_at: userSchema.hasMfaTotpEnabledAt ? (((user as any).mfa_totp_enabled_at as string | null) ?? null) : null,
      pending_setup: Boolean(userSchema.hasMfaTotpPendingExpiresAt && (user as any).mfa_totp_pending_expires_at),
      pending_expires_at: userSchema.hasMfaTotpPendingExpiresAt ? (((user as any).mfa_totp_pending_expires_at as string | null) ?? null) : null,
      email_fallback_enabled: sessionUser.role !== 'admin',
      passkey_count: passkeyCount,
      email,
      masked_email: maskEmail(email)
    });
  });

  app.post('/api/auth/mfa/totp/setup', async (c) => {
    const productionSecretError = requireProductionSecret(c, 'AUTH_ENCRYPTION_KEY', 'TOTP setup');
    if (productionSecretError) {
      return productionSecretError;
    }

    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const userSchema = await getUserSchemaSupport(c.env.DB);
    if (!userSchema.hasMfaTotpPendingSecret || !userSchema.hasMfaTotpPendingExpiresAt) {
      return c.json({ error: 'TOTP MFA is not available' }, 503);
    }

    const user = await c.env.DB.prepare(
      `SELECT id, username${userSchema.hasEmail ? ', email' : ''} FROM users WHERE id = ?`
    ).bind(sessionUser.userId).first();
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const email = ((user as any).email as string | null) ?? ((user as any).username as string);
    const secret = createTotpSecret();
    const expiresAt = new Date(Date.now() + MFA_TTL_MS).toISOString();
    const nowIso = new Date().toISOString();
    const encryptedSecret = await encryptSecret(c.env, secret);
    await c.env.DB.prepare(
      `UPDATE users
       SET mfa_totp_pending_secret = ?, mfa_totp_pending_expires_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(encryptedSecret, expiresAt, nowIso, sessionUser.userId).run();

    await recordAuditLog(c, {
      action: 'mfa_totp_setup_start',
      resourceType: 'users',
      resourceId: sessionUser.userId,
      summary: `開始設定 TOTP ${email}`,
      details: {
        email,
        expires_at: expiresAt
      }
    });

    return c.json({
      secret,
      otpauth_url: buildTotpOtpAuthUrl(email, secret),
      expires_at: expiresAt,
      email
    });
  });

  app.post('/api/auth/mfa/totp/confirm', async (c) => {
    const productionSecretError = requireProductionSecret(c, 'AUTH_ENCRYPTION_KEY', 'TOTP setup');
    if (productionSecretError) {
      return productionSecretError;
    }

    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const userSchema = await getUserSchemaSupport(c.env.DB);
    if (!userSchema.hasMfaTotpSecret || !userSchema.hasMfaTotpEnabledAt || !userSchema.hasMfaTotpPendingSecret || !userSchema.hasMfaTotpPendingExpiresAt) {
      return c.json({ error: 'TOTP MFA is not available' }, 503);
    }

    const body = await c.req.json();
    const code = normalizeOtpCode((body as any)?.code);
    if (!code) {
      return c.json({ error: 'code is required' }, 400);
    }

    const user = await c.env.DB.prepare(
      `SELECT id, username${userSchema.hasEmail ? ', email' : ''}, mfa_totp_pending_secret, mfa_totp_pending_expires_at
       FROM users
       WHERE id = ?`
    ).bind(sessionUser.userId).first();
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const pendingSecret = await decryptSecret(c.env, ((user as any).mfa_totp_pending_secret as string | null) ?? null);
    const pendingExpiresAt = ((user as any).mfa_totp_pending_expires_at as string | null) ?? null;
    if (!pendingSecret || !pendingExpiresAt || pendingExpiresAt <= new Date().toISOString()) {
      return c.json({ error: 'TOTP setup expired. Start setup again.' }, 400);
    }

    const isValid = await verifyTotpCode(pendingSecret, code);
    if (!isValid) {
      return c.json({ error: 'Invalid authenticator code' }, 400);
    }

    const email = ((user as any).email as string | null) ?? ((user as any).username as string);
    const nowIso = new Date().toISOString();
    const encryptedSecret = await encryptSecret(c.env, pendingSecret);
    await c.env.DB.prepare(
      `UPDATE users
       SET mfa_totp_secret = ?, mfa_totp_enabled_at = ?, mfa_totp_pending_secret = NULL, mfa_totp_pending_expires_at = NULL, updated_at = ?
       WHERE id = ?`
    ).bind(encryptedSecret, nowIso, nowIso, sessionUser.userId).run();

    await recordAuditLog(c, {
      action: 'mfa_totp_enabled',
      resourceType: 'users',
      resourceId: sessionUser.userId,
      summary: `啟用 TOTP ${email}`,
      details: {
        email
      }
    });

    return c.json({ ok: true, enabled_at: nowIso });
  });

  app.post('/api/auth/logout', async (c) => {
    const sessionId = getSessionIdFromRequest(c);
    if (sessionId) {
      await deleteSessionsByToken(c.env.DB, sessionId);
    }
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', async (c) => {
    const sessionId = getSessionIdFromRequest(c);
    if (!sessionId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sessionUser = await getSessionUser(c.env.DB, sessionId);
    if (!sessionUser) {
      clearSessionCookie(c);
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const accountData = await getAccountById(c.env.DB, sessionUser.userId);
    if (!accountData) {
      clearSessionCookie(c);
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return c.json({ user: accountData.account });
  });

  app.get('/api/auth/account', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const accountData = await getAccountById(c.env.DB, sessionUser.userId);
    if (!accountData) {
      return c.json({ error: 'User not found' }, 404);
    }
    return c.json(accountData.account);
  });

  app.put('/api/auth/account', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const userSchema = await getUserSchemaSupport(c.env.DB);
    const body = await c.req.json();
    const hasEmailUpdate = typeof (body as any)?.email === 'string';
    const nextEmail = hasEmailUpdate ? normalizeEmail((body as any).email) : '';
    const hasAvatarUpdate = Object.prototype.hasOwnProperty.call(body as object, 'avatar_url');
    const avatarUrlRaw = hasAvatarUpdate ? (body as any).avatar_url : undefined;
    const nextAvatarUrl = typeof avatarUrlRaw === 'string' ? avatarUrlRaw.trim() : null;

    if (!hasEmailUpdate && !hasAvatarUpdate) {
      return c.json({ error: 'email or avatar_url is required' }, 400);
    }
    if (hasEmailUpdate && (!nextEmail || !isValidEmail(nextEmail))) {
      return c.json({ error: 'Invalid email format' }, 400);
    }

    const existing = await c.env.DB.prepare(
      `SELECT id, username${userSchema.hasEmail ? ', email' : ''}${userSchema.hasEmailVerifiedAt ? ', email_verified_at' : ''}${userSchema.hasAvatarUrl ? ', avatar_url' : ''}, password_hash, password_salt
       FROM users WHERE id = ?`
    ).bind(sessionUser.userId).first();
    if (!existing) {
      return c.json({ error: 'User not found' }, 404);
    }

    const updates: string[] = ['updated_at = ?'];
    const values: Array<string | null> = [new Date().toISOString()];
    let delivered = false;
    const changedFields: string[] = [];

    if (hasEmailUpdate) {
      const currentEmail = ((existing as any).email as string | null) ?? ((existing as any).username as string);
      if (currentEmail !== nextEmail) {
        const duplicateField = userSchema.hasEmail ? 'email' : 'username';
        const duplicate = await c.env.DB.prepare(
          `SELECT id FROM users WHERE ${duplicateField} = ? AND id != ?`
        ).bind(nextEmail, sessionUser.userId).first();
        if (duplicate) {
          return c.json({ error: 'User already exists' }, 409);
        }
        updates.push('username = ?');
        values.push(nextEmail);
        if (userSchema.hasEmail) {
          updates.push('email = ?');
          values.push(nextEmail);
        }
        if (userSchema.hasEmailVerifiedAt) {
          updates.push('email_verified_at = ?');
          values.push(null);
        }
        if (userSchema.hasEmailVerifyTokenHash && userSchema.hasEmailVerifyExpiresAt) {
          const token = await createVerificationToken();
          updates.push('email_verify_token_hash = ?', 'email_verify_expires_at = ?');
          values.push(token.tokenHash, token.expiresAt);
          const invitePending = isInvitePendingPassword((existing as any).password_hash, (existing as any).password_salt);
          delivered = invitePending
            ? await sendInvitationEmail(c.env, nextEmail, buildInvitationUrl(c.env, token.token))
            : await sendVerificationEmail(c.env, nextEmail, buildVerificationUrl(c.env, token.token));
        }
        changedFields.push('email');
      }
    }

    if (hasAvatarUpdate && userSchema.hasAvatarUrl) {
      updates.push('avatar_url = ?');
      values.push(nextAvatarUrl);
      changedFields.push('avatar_url');
    }

    if (changedFields.length === 0) {
      const accountData = await getAccountById(c.env.DB, sessionUser.userId);
      return c.json(accountData?.account ?? { error: 'User not found' }, accountData ? 200 : 404);
    }

    values.push(sessionUser.userId);
    await c.env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    const accountData = await getAccountById(c.env.DB, sessionUser.userId);
    if (!accountData) {
      return c.json({ error: 'User not found' }, 404);
    }

    await recordAuditLog(c, {
      action: 'update',
      resourceType: 'account',
      resourceId: sessionUser.userId,
      summary: `更新個人帳號 ${accountData.account.username}`,
      details: {
        changed_fields: changedFields,
        verification_email_sent: delivered
      }
    });

    return c.json(accountData.account);
  });

  app.post('/api/auth/account/avatar', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const accountAvatarRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'account_avatar_upload',
      limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
      ...ACCOUNT_AVATAR_RATE_LIMIT
    });
    if (!accountAvatarRateLimit.allowed) {
      c.header('Retry-After', String(accountAvatarRateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'account_avatar_upload',
        limiterKey: `${sessionUser.userId}:${getRequestIpAddress(c) || 'unknown-ip'}`,
        route: '/api/auth/account/avatar',
        retryAfterSeconds: accountAvatarRateLimit.retryAfterSeconds,
        summary: `帳號頭像上傳速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many avatar uploads' }, 429);
    }
    const userSchema = await getUserSchemaSupport(c.env.DB);
    if (!userSchema.hasAvatarUrl) {
      return c.json({ error: 'Avatar storage unavailable' }, 503);
    }

    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') {
      return c.json({ error: 'file is required' }, 400);
    }
    const upload = file as File;
    let validated;
    try {
      validated = await validateAvatarUpload(upload, MAX_AVATAR_BYTES);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unsupported file type';
      return c.json({ error: message }, message === 'file is too large' ? 413 : 400);
    }

    const key = `user-${sessionUser.userId}-${Date.now()}-${crypto.randomUUID()}.${validated.extension}`;
    await c.env.AVATARS.put(key, validated.bytes, {
      httpMetadata: { contentType: validated.contentType }
    });
    const avatarUrl = `/api/avatars/${key}`;
    await c.env.DB.prepare(
      'UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?'
    ).bind(avatarUrl, new Date().toISOString(), sessionUser.userId).run();

    const accountData = await getAccountById(c.env.DB, sessionUser.userId);
    if (!accountData) {
      return c.json({ error: 'User not found' }, 404);
    }

    await recordAuditLog(c, {
      action: 'update_avatar',
      resourceType: 'account',
      resourceId: sessionUser.userId,
      summary: `更新帳號頭像 ${accountData.account.username}`,
      details: {
        avatar_url: avatarUrl
      }
    });

    return c.json(accountData.account);
  });

  app.post('/api/auth/account/change-password', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const body = await c.req.json();
    const currentPassword = typeof (body as any)?.current_password === 'string' ? (body as any).current_password : '';
    const nextPassword = typeof (body as any)?.new_password === 'string' ? (body as any).new_password : '';
    if (!currentPassword || !nextPassword) {
      return c.json({ error: 'current_password and new_password are required' }, 400);
    }

    const userSchema = await getUserSchemaSupport(c.env.DB);
    const user = await c.env.DB.prepare(
      `SELECT id, username, password_hash, password_salt${userSchema.hasEmail ? ', email' : ''} FROM users WHERE id = ?`
    ).bind(sessionUser.userId).first();
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }
    const actualHash = await hashPassword(currentPassword, (user as any).password_salt as string);
    if (!timingSafeEqual(actualHash, (user as any).password_hash as string)) {
      return c.json({ error: 'Current password is incorrect' }, 400);
    }

    const compareEmail = ((user as any).email as string | null) ?? ((user as any).username as string);
    const passwordValidationError = validatePasswordStrength(nextPassword, [compareEmail]);
    if (passwordValidationError) {
      return c.json({ error: passwordValidationError }, 400);
    }

    const salt = randomBase64(16);
    const passwordHash = await hashPassword(nextPassword, salt);
    await c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?'
    ).bind(passwordHash, salt, new Date().toISOString(), sessionUser.userId).run();

    const currentSessionToken = getSessionIdFromRequest(c);
    const revokedSessions = await revokeUserSessions(c.env.DB, sessionUser.userId, currentSessionToken);
    if (isValidEmail(compareEmail)) {
      await sendPasswordChangedEmail(c.env, compareEmail);
    }

    await recordAuditLog(c, {
      action: 'change_password',
      resourceType: 'account',
      resourceId: sessionUser.userId,
      summary: `變更個人密碼 ${compareEmail}`,
      details: {
        revoked_other_sessions: revokedSessions
      }
    });

    return c.json({ ok: true, revoked_other_sessions: revokedSessions });
  });

  app.get('/api/auth/sessions', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const schema = await getSessionSchemaSupport(c.env.DB);
    const fields = ['id', 'user_id', 'created_at', 'expires_at'];
    if (schema.hasUserAgent) fields.push('user_agent');
    if (schema.hasIpAddress) fields.push('ip_address');
    if (schema.hasLastSeenAt) fields.push('last_seen_at');

    const nowIso = new Date().toISOString();
    const { results } = await c.env.DB.prepare(
      `SELECT ${fields.join(', ')} FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC`
    ).bind(sessionUser.userId, nowIso).all();

    const currentSessionId = getSessionIdFromRequest(c);
    const sessions = await Promise.all(results.map(async (row) => {
      const userAgent = schema.hasUserAgent ? ((row as any).user_agent as string | null) : null;
      const client = classifyClient(userAgent);
      return {
        id: (row as any).id as string,
        user_id: (row as any).user_id as string,
        created_at: (row as any).created_at as string,
        expires_at: (row as any).expires_at as string,
        user_agent: userAgent,
        ip_address: schema.hasIpAddress ? ((row as any).ip_address as string | null) : null,
        last_seen_at: schema.hasLastSeenAt ? ((row as any).last_seen_at as string | null) : null,
        browser: client.browser,
        platform: client.platform,
        device_label: client.deviceLabel,
        current: await matchesSessionToken((row as any).id as string, currentSessionId)
      };
    }));
    return c.json(sessions);
  });

  app.delete('/api/auth/sessions/:id', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      'SELECT id, user_id FROM sessions WHERE id = ?'
    ).bind(id).first();
    if (!existing) {
      return c.json({ error: 'Session not found' }, 404);
    }
    if ((existing as any).user_id !== sessionUser.userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    const currentSessionId = getSessionIdFromRequest(c);
    const isCurrent = await matchesSessionToken(id, currentSessionId);
    if (isCurrent) {
      clearSessionCookie(c);
    }
    await recordAuditLog(c, {
      action: 'revoke',
      resourceType: 'sessions',
      resourceId: id,
      summary: `撤銷 session ${id}`,
      details: {
        session_id: id,
        current: isCurrent
      }
    });
    return c.json({ ok: true, current: isCurrent });
  });

  app.post('/api/auth/sessions/revoke-others', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const currentSessionId = getSessionIdFromRequest(c);
    if (!currentSessionId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const keepIds = await getSessionLookupIds(currentSessionId);
    const result = await c.env.DB.prepare(
      `DELETE FROM sessions
       WHERE user_id = ?
         AND id NOT IN (${keepIds.map(() => '?').join(', ')})`
    ).bind(sessionUser.userId, ...keepIds).run();
    await recordAuditLog(c, {
      action: 'revoke_others',
      resourceType: 'sessions',
      summary: '撤銷其他登入 session',
      details: {
        deleted: Number(result.meta?.changes ?? 0)
      }
    });
    return c.json({ ok: true, deleted: Number(result.meta?.changes ?? 0) });
  });

  app.post('/api/auth/users', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const userSchema = await getUserSchemaSupport(c.env.DB);

    const currentIp = getRequestIpAddress(c) || 'unknown-ip';
    const inviteRateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'invite_create',
      limiterKey: `${sessionUser.userId}:${currentIp}`,
      ...INVITE_CREATE_RATE_LIMIT
    });
    if (!inviteRateLimit.allowed) {
      c.header('Retry-After', String(inviteRateLimit.retryAfterSeconds));
      await recordRateLimitAudit(c, {
        action: 'invite_create',
        limiterKey: `${sessionUser.userId}:${currentIp}`,
        route: '/api/auth/users',
        retryAfterSeconds: inviteRateLimit.retryAfterSeconds,
        summary: `邀請建立速率限制：${sessionUser.username}`
      });
      return c.json({ error: 'Too many invite requests' }, 429);
    }

    const body = await c.req.json();
    const email = normalizeEmail((body as any)?.email ?? (body as any)?.username);
    const role = (body as any)?.role as UserRole | undefined;
    if (!email) {
      return c.json({ error: 'email is required' }, 400);
    }
    if (!isValidEmail(email)) {
      return c.json({ error: 'Invalid email format' }, 400);
    }

    const finalRole: UserRole = role === 'admin' ? 'admin' : 'readonly';
    const existingField = userSchema.hasEmail ? 'email' : 'username';
    const existing = await c.env.DB.prepare(
      `SELECT id FROM users WHERE ${existingField} = ?`
    ).bind(email).first();
    if (existing) {
      return c.json({ error: 'User already exists' }, 409);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    let verifyToken: string | null = null;
    let verifyTokenHash: string | null = null;
    let verifyExpiresAt: string | null = null;
    if (userSchema.hasEmailVerifyTokenHash && userSchema.hasEmailVerifyExpiresAt) {
      const token = await createVerificationToken();
      verifyToken = token.token;
      verifyTokenHash = token.tokenHash;
      verifyExpiresAt = token.expiresAt;
    }

    const columns = ['id', 'username', 'password_hash', 'password_salt', 'role', 'created_at', 'updated_at'];
    const values: Array<string | null> = [
      id,
      email,
      INVITE_PENDING_PASSWORD_HASH,
      INVITE_PENDING_PASSWORD_SALT,
      finalRole,
      now,
      now
    ];
    if (userSchema.hasEmail) {
      columns.push('email');
      values.push(email);
    }
    if (userSchema.hasEmailVerifiedAt) {
      columns.push('email_verified_at');
      values.push(null);
    }
    if (userSchema.hasEmailVerifyTokenHash) {
      columns.push('email_verify_token_hash');
      values.push(verifyTokenHash);
    }
    if (userSchema.hasEmailVerifyExpiresAt) {
      columns.push('email_verify_expires_at');
      values.push(verifyExpiresAt);
    }
    await c.env.DB.prepare(
      `INSERT INTO users (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...values).run();

    let delivered = false;
    if (verifyToken) {
      const inviteUrl = buildInvitationUrl(c.env, verifyToken);
      delivered = await sendInvitationEmail(c.env, email, inviteUrl);
    }

    notifyUpdate(c, 'user:create', {
      id,
      username: email,
      role: finalRole
    });
    await recordAuditLog(c, {
      action: 'create',
      resourceType: 'users',
      resourceId: id,
      summary: `新增帳號 ${email}`,
      details: {
        username: email,
        role: finalRole,
        invitation_email_sent: delivered
      }
    });
    const debugToken = (c.env.ENVIRONMENT === 'production' || !verifyToken) ? null : verifyToken;
    return c.json({
      id,
      username: email,
      email,
      role: finalRole,
      email_verified_at: null,
      invitation_email_sent: delivered,
      ...(debugToken ? { debug_invite_token: debugToken } : {})
    }, 201);
  });

  app.get('/api/auth/users', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const userSchema = await getUserSchemaSupport(c.env.DB);

    const fields = [
      'u.id',
      'u.username',
      'u.role',
      'u.created_at',
      'u.updated_at',
      '(SELECT MIN(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS first_login_at',
      '(SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS latest_login_at'
    ];
    if (userSchema.hasEmail) fields.push('email');
    if (userSchema.hasEmailVerifiedAt) fields.push('email_verified_at');
    const peoplePragma = await c.env.DB.prepare("PRAGMA table_info('people')").all();
    const peopleHasEmail = (peoplePragma.results as Array<Record<string, unknown>>)
      .some((row) => String((row as any).name) === 'email');
    const linkedPersonFields = peopleHasEmail
      ? `, (
            SELECT p.id
            FROM people p
            WHERE LOWER(TRIM(COALESCE(p.email, ''))) = LOWER(TRIM(COALESCE(u.${userSchema.hasEmail ? 'email' : 'username'}, '')))
            ORDER BY p.updated_at DESC, p.created_at DESC, p.id DESC
            LIMIT 1
          ) AS linked_person_id,
          (
            SELECT p.name
            FROM people p
            WHERE LOWER(TRIM(COALESCE(p.email, ''))) = LOWER(TRIM(COALESCE(u.${userSchema.hasEmail ? 'email' : 'username'}, '')))
            ORDER BY p.updated_at DESC, p.created_at DESC, p.id DESC
            LIMIT 1
          ) AS linked_person_name`
      : '';
    const { results } = await c.env.DB.prepare(
      `SELECT ${fields.join(', ')}${linkedPersonFields} FROM users u ORDER BY u.created_at DESC`
    ).all();

    return c.json(results.map((row) => ({
      id: (row as any).id as string,
      username: (row as any).username as string,
      email: ((row as any).email as string | null) ?? ((row as any).username as string),
      linked_person_id: ((row as any).linked_person_id as string | null) ?? null,
      linked_person_name: ((row as any).linked_person_name as string | null) ?? null,
      email_verified_at: userSchema.hasEmailVerifiedAt ? (((row as any).email_verified_at as string | null) ?? null) : null,
      first_login_at: ((row as any).first_login_at as string | null) ?? null,
      latest_login_at: ((row as any).latest_login_at as string | null) ?? null,
      role: normalizeRole((row as any).role),
      created_at: (row as any).created_at as string,
      updated_at: (row as any).updated_at as string
    })));
  });

  app.put('/api/auth/users/:id', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const userSchema = await getUserSchemaSupport(c.env.DB);

    const id = c.req.param('id');
    const body = await c.req.json();
    const role = (body as any)?.role as UserRole | undefined;
    const password = typeof (body as any)?.password === 'string' ? (body as any).password : '';
    const hasEmailUpdate = typeof (body as any)?.email === 'string';
    const nextEmail = hasEmailUpdate ? normalizeEmail((body as any).email) : '';
    if (!role && !password && !hasEmailUpdate) {
      return c.json({ error: 'role or password or email is required' }, 400);
    }
    if (hasEmailUpdate && (!nextEmail || !isValidEmail(nextEmail))) {
      return c.json({ error: 'Invalid email format' }, 400);
    }

    const existing = await c.env.DB.prepare(
      `SELECT id, username, role, password_hash, password_salt${userSchema.hasEmail ? ', email' : ''} FROM users WHERE id = ?`
    ).bind(id).first();
    if (!existing) {
      return c.json({ error: 'User not found' }, 404);
    }

    const existingRole = normalizeRole((existing as any).role);
    const nextRole = role ? normalizeRole(role) : existingRole;

    if (sessionUser.userId === id && nextRole !== 'admin') {
      return c.json({ error: 'Cannot remove your own admin role' }, 400);
    }

    if (existingRole === 'admin' && nextRole !== 'admin') {
      const remaining = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND id != ?"
      ).bind(id).first();
      const remainingAdmins = Number((remaining as any)?.count ?? 0);
      if (remainingAdmins <= 0) {
        return c.json({ error: 'At least one admin is required' }, 400);
      }
    }

    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = ?'];
    const values: Array<string | null> = [now];
    let delivered = false;
    let passwordNotificationSent = false;

    if (role) {
      updates.push('role = ?');
      values.push(nextRole);
    }

    if (password) {
      const currentEmail = ((existing as any).email as string | null) ?? ((existing as any).username as string);
      const compareEmail = hasEmailUpdate ? nextEmail : currentEmail;
      const passwordValidationError = validatePasswordStrength(password, [compareEmail]);
      if (passwordValidationError) {
        return c.json({ error: passwordValidationError }, 400);
      }
      const salt = randomBase64(16);
      const passwordHash = await hashPassword(password, salt);
      updates.push('password_hash = ?', 'password_salt = ?');
      values.push(passwordHash, salt);
    }

    if (hasEmailUpdate) {
      const currentEmail = ((existing as any).email as string | null) ?? ((existing as any).username as string);
      if (currentEmail !== nextEmail) {
        const duplicateField = userSchema.hasEmail ? 'email' : 'username';
        const duplicate = await c.env.DB.prepare(
          `SELECT id FROM users WHERE ${duplicateField} = ? AND id != ?`
        ).bind(nextEmail, id).first();
        if (duplicate) {
          return c.json({ error: 'User already exists' }, 409);
        }

        updates.push('username = ?');
        values.push(nextEmail);
        if (userSchema.hasEmail) {
          updates.push('email = ?');
          values.push(nextEmail);
        }
        if (userSchema.hasEmailVerifiedAt) {
          updates.push('email_verified_at = ?');
          values.push(null);
        }
        if (userSchema.hasEmailVerifyTokenHash && userSchema.hasEmailVerifyExpiresAt) {
          const token = await createVerificationToken();
          updates.push('email_verify_token_hash = ?', 'email_verify_expires_at = ?');
          values.push(token.tokenHash, token.expiresAt);
          const invitePending = isInvitePendingPassword((existing as any).password_hash, (existing as any).password_salt);
          const actionUrl = invitePending ? buildInvitationUrl(c.env, token.token) : buildVerificationUrl(c.env, token.token);
          delivered = invitePending
            ? await sendInvitationEmail(c.env, nextEmail, actionUrl)
            : await sendVerificationEmail(c.env, nextEmail, actionUrl);
        }
      }
    }

    values.push(id);
    await c.env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    const updated = await c.env.DB.prepare(
      `SELECT id, username, role, created_at, updated_at${userSchema.hasEmail ? ', email' : ''}${userSchema.hasEmailVerifiedAt ? ', email_verified_at' : ''} FROM users WHERE id = ?`
    ).bind(id).first();

    if (password && updated) {
      await revokeUserSessions(c.env.DB, id, null);
      const destinationEmail = ((updated as any).email as string | null) ?? ((updated as any).username as string);
      if (destinationEmail && isValidEmail(destinationEmail)) {
        passwordNotificationSent = await sendPasswordChangedEmail(c.env, destinationEmail);
      }
    }

    notifyUpdate(c, 'user:update', {
      id,
      username: (updated as any).username,
      role: normalizeRole((updated as any).role)
    });
    await recordAuditLog(c, {
      action: 'update',
      resourceType: 'users',
      resourceId: id,
      summary: `更新帳號 ${(updated as any).username}`,
      details: {
        username: (updated as any).username,
        role: normalizeRole((updated as any).role),
        changed_fields: [
          ...(role ? ['role'] : []),
          ...(password ? ['password'] : []),
          ...(hasEmailUpdate ? ['email'] : [])
        ],
        verification_email_sent: delivered,
        password_notification_sent: passwordNotificationSent
      }
    });

    return c.json({
      id: (updated as any).id as string,
      username: (updated as any).username as string,
      email: ((updated as any).email as string | null) ?? ((updated as any).username as string),
      email_verified_at: userSchema.hasEmailVerifiedAt ? (((updated as any).email_verified_at as string | null) ?? null) : null,
      role: normalizeRole((updated as any).role),
      created_at: (updated as any).created_at as string,
      updated_at: (updated as any).updated_at as string,
      password_notification_sent: passwordNotificationSent
    });
  });

  app.delete('/api/auth/users/:id', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser || sessionUser.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const id = c.req.param('id');
    if (sessionUser.userId === id) {
      return c.json({ error: 'Cannot delete your own account' }, 400);
    }

    const existing = await c.env.DB.prepare(
      'SELECT id, username, role FROM users WHERE id = ?'
    ).bind(id).first();
    if (!existing) {
      return c.json({ error: 'User not found' }, 404);
    }

    if (normalizeRole((existing as any).role) === 'admin') {
      const remaining = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND id != ?"
      ).bind(id).first();
      const remainingAdmins = Number((remaining as any)?.count ?? 0);
      if (remainingAdmins <= 0) {
        return c.json({ error: 'At least one admin is required' }, 400);
      }
    }

    await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();

    notifyUpdate(c, 'user:delete', {
      id,
      username: (existing as any).username as string,
      role: normalizeRole((existing as any).role)
    });
    await recordAuditLog(c, {
      action: 'delete',
      resourceType: 'users',
      resourceId: id,
      summary: `刪除帳號 ${(existing as any).username as string}`,
      details: {
        username: (existing as any).username as string,
        role: normalizeRole((existing as any).role)
      }
    });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Passkey (WebAuthn) endpoints
  // ---------------------------------------------------------------------------

  app.get('/api/auth/passkey/register/begin', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const registerIp = getRequestIpAddress(c) || 'unknown-ip';
    const rateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'passkey_register',
      limiterKey: `${sessionUser.userId}:${registerIp}`,
      ...PASSKEY_REGISTER_RATE_LIMIT
    });
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      return c.json({ error: 'Too many registration attempts. Please try again later.' }, 429);
    }

    await ensurePasskeysTable(c.env.DB);

    if (!getPasskeyChallengeSecret(c.env)) {
      return c.json({ error: 'Server misconfiguration: passkey challenge secret is required' }, 503);
    }

    const challenge = randomBase64Url(32);
    await setPasskeyChallengeCookie(c, {
      challenge,
      flow: 'register',
      userId: sessionUser.userId
    });

    // Get existing credentials to exclude
    const existing = await c.env.DB.prepare(
      'SELECT credential_id FROM auth_passkeys WHERE user_id = ?'
    ).bind(sessionUser.userId).all();
    const excludeCredentials = (existing.results as Array<Record<string, unknown>>)
      .map(row => ({ id: String(row.credential_id) }));

    const rpId = getRpId(c.env);
    const timeout = 60000;

    return c.json({
      challenge,
      rp: { id: rpId, name: 'Clan Node' },
      user: {
        id: encodePasskeyUserHandle(sessionUser.userId),
        name: sessionUser.username,
        displayName: sessionUser.username
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' }
      ],
      timeout,
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        requireResidentKey: false
      },
      excludeCredentials: excludeCredentials.map(cred => ({
        id: cred.id,
        type: 'public-key' as const,
        transports: ['internal', 'hybrid'] as string[]
      }))
    });
  });

  app.post('/api/auth/passkey/register/finish', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await ensurePasskeysTable(c.env.DB);

    const body = await c.req.json();
    const credentialId = normalizeIdentifier((body as any)?.id);
    const rawId = normalizeIdentifier((body as any)?.rawId);
    const clientDataJson = normalizeIdentifier((body as any)?.response?.clientDataJSON);
    const attestationObject = normalizeIdentifier((body as any)?.response?.attestationObject);
    const authenticatorData = normalizeIdentifier((body as any)?.response?.authenticatorData);
    const publicKey = normalizeIdentifier((body as any)?.response?.publicKey);
    const alg = Number((body as any)?.response?.alg) || -7;
    const name = normalizeIdentifier((body as any)?.name) || undefined;

    if (!credentialId || !clientDataJson) {
      return c.json({ error: 'credential id and client data are required' }, 400);
    }

    const expectedRpId = getRpId(c.env);
    const challengeState = await getPasskeyChallengeState(c);
    if (!challengeState || challengeState.flow !== 'register' || challengeState.userId !== sessionUser.userId) {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Passkey registration challenge is missing or expired' }, 400);
    }

    // Verify client data
    const clientData = decodePasskeyClientData(clientDataJson);
    if (!clientData) {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Invalid client data' }, 400);
    }
    if (clientData.type !== 'webauthn.create') {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Invalid client data type' }, 400);
    }
    if (clientData.origin !== getExpectedOrigin(c.env)) {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Invalid origin' }, 400);
    }
    if (!timingSafeEqual(clientData.challenge, challengeState.challenge)) {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Invalid challenge' }, 400);
    }

    let credentialPublicKey: Uint8Array;
    let credentialAlgorithm = alg;
    let authDataFlags: number;
    let authDataCounter: number;

    if (attestationObject) {
      // Full attestation flow
      const attestation = parseAttestationObject(attestationObject);
      if (!attestation) {
        clearPasskeyChallengeCookie(c);
        return c.json({ error: 'Invalid attestation object' }, 400);
      }
      authDataFlags = attestation.authData.flags;
      authDataCounter = attestation.authData.counter;

      // Verify RP ID hash
      const rpIdHash = await sha256Raw(expectedRpId);
      if (!bytesEqual(rpIdHash, attestation.authData.rpIdHash)) {
        clearPasskeyChallengeCookie(c);
        return c.json({ error: 'Invalid RP ID' }, 400);
      }

      credentialPublicKey = attestation.authData.credentialPublicKey;
      credentialAlgorithm = parseCosePublicKey(credentialPublicKey)?.alg ?? alg;
    } else if (authenticatorData && publicKey) {
      // Simplified flow (client sends parsed data)
      authDataFlags = parseAuthDataFlags(authenticatorData);
      authDataCounter = parseAuthDataCounter(authenticatorData);

      const rpIdHash = await sha256Raw(expectedRpId);
      const authDataRpIdHash = parseAuthDataRpIdHash(authenticatorData);
      if (!bytesEqual(rpIdHash, authDataRpIdHash)) {
        clearPasskeyChallengeCookie(c);
        return c.json({ error: 'Invalid RP ID' }, 400);
      }

      credentialPublicKey = fromBase64Url(publicKey);
      credentialAlgorithm = parseCosePublicKey(credentialPublicKey)?.alg ?? alg;
    } else {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'attestation object or authenticator data + public key is required' }, 400);
    }

    // Verify user was present
    if (!(authDataFlags & 0x01)) {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'User presence not verified' }, 400);
    }

    const nowIso = new Date().toISOString();
    const passkeyId = crypto.randomUUID();

    await c.env.DB.prepare(
      `INSERT INTO auth_passkeys (
        id, user_id, credential_id, credential_public_key, algorithm, counter,
        device_type, backup_eligible, backup_state, name, last_used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      passkeyId,
      sessionUser.userId,
      credentialId,
      toBase64Url(credentialPublicKey),
      credentialAlgorithm,
      authDataCounter,
      authDataFlags & 0x08 ? 'multi_device' : 'single_device',
      authDataFlags & 0x08 ? 1 : 0,
      authDataFlags & 0x10 ? 1 : 0,
      name || null,
      nowIso,
      nowIso
    ).run();
    clearPasskeyChallengeCookie(c);

    await recordAuditLog(c, {
      action: 'passkey_register',
      resourceType: 'auth',
      resourceId: sessionUser.userId,
      summary: `註冊 Passkey ${sessionUser.username}`,
      details: {
        passkey_id: passkeyId,
        name: name || null,
        device_type: authDataFlags & 0x08 ? 'multi_device' : 'single_device'
      }
    });

    return c.json({ ok: true, name: name || 'Passkey' });
  });

  app.get('/api/auth/passkey/login/begin', async (c) => {
    const loginIp = getRequestIpAddress(c) || 'unknown-ip';
    const rateLimit = await checkAndConsumeRateLimit(c.env.DB, {
      action: 'passkey_login',
      limiterKey: loginIp,
      ...PASSKEY_LOGIN_RATE_LIMIT
    });
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds));
      return c.json({ error: 'Too many login attempts. Please try again later.' }, 429);
    }

    await ensurePasskeysTable(c.env.DB);

    if (!getPasskeyChallengeSecret(c.env)) {
      return c.json({ error: 'Server misconfiguration: passkey challenge secret is required' }, 503);
    }

    const challenge = randomBase64Url(32);
    await setPasskeyChallengeCookie(c, { challenge, flow: 'login' });
    const rpId = getRpId(c.env);

    // Get all known credentials for conditional UI
    const allCredentials = await c.env.DB.prepare(
      'SELECT credential_id FROM auth_passkeys'
    ).all();
    const allowCredentials = (allCredentials.results as Array<Record<string, unknown>>)
      .map(row => ({ id: String(row.credential_id) }));

    return c.json({
      challenge,
      rpId,
      timeout: 60000,
      userVerification: 'preferred',
      allowCredentials: allowCredentials.slice(0, 30).map(cred => ({
        id: cred.id,
        type: 'public-key' as const,
        transports: ['internal', 'hybrid', 'cable', 'ble', 'nfc', 'usb'] as string[]
      }))
    });
  });

  app.post('/api/auth/passkey/login/finish', async (c) => {
    await ensurePasskeysTable(c.env.DB);

    const body = await c.req.json();
    const credentialId = normalizeIdentifier((body as any)?.id);
    const rawId = normalizeIdentifier((body as any)?.rawId);
    const clientDataJson = normalizeIdentifier((body as any)?.response?.clientDataJSON);
    const authenticatorData = normalizeIdentifier((body as any)?.response?.authenticatorData);
    const signature = normalizeIdentifier((body as any)?.response?.signature);
    const userHandle = normalizeIdentifier((body as any)?.userHandle);

    if (!credentialId || !clientDataJson || !authenticatorData || !signature) {
      return c.json({ error: 'credential id, client data, authenticator data, and signature are required' }, 400);
    }

    const expectedRpId = getRpId(c.env);
    const expectedRpIdHash = await sha256Raw(expectedRpId);
    const challengeState = await getPasskeyChallengeState(c);
    if (!challengeState || challengeState.flow !== 'login') {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Passkey login challenge is missing or expired' }, 400);
    }

    // Verify client data
    const clientData = decodePasskeyClientData(clientDataJson);
    if (!clientData) {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Invalid client data' }, 400);
    }
    if (clientData.type !== 'webauthn.get') {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Invalid client data type' }, 400);
    }
    if (clientData.origin !== getExpectedOrigin(c.env)) {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Invalid origin' }, 400);
    }
    if (!timingSafeEqual(clientData.challenge, challengeState.challenge)) {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Invalid challenge' }, 400);
    }
    if (!bytesEqual(expectedRpIdHash, parseAuthDataRpIdHash(authenticatorData))) {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Invalid RP ID' }, 400);
    }
    const authDataFlags = parseAuthDataFlags(authenticatorData);
    if (!(authDataFlags & 0x01)) {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'User presence not verified' }, 400);
    }

    // Look up the passkey
    const passkey = await c.env.DB.prepare(
      'SELECT id, user_id, credential_public_key, algorithm, counter, backup_eligible, backup_state, name, last_used_at'
      + ' FROM auth_passkeys WHERE credential_id = ?'
    ).bind(credentialId).first();

    if (!passkey) {
      await recordLoginAttempt(c, {
        email: 'passkey-unknown',
        success: false,
        reason: 'passkey_not_found'
      });
      return c.json({ error: 'Invalid passkey' }, 401);
    }

    // If userHandle provided, verify it matches
    if (userHandle && !matchesPasskeyUserHandle(userHandle, String((passkey as any).user_id))) {
      clearPasskeyChallengeCookie(c);
      return c.json({ error: 'Invalid user handle' }, 401);
    }

    // Verify signature
    const publicKey = fromBase64Url((passkey as any).credential_public_key as string);
    const algo = Number((passkey as any).algorithm) || -7;

    const clientDataHash = await sha256Bytes(clientData.rawBytes);
    const authDataBytes = fromBase64Url(authenticatorData);
    const sigBytes = fromBase64Url(signature);

    const message = new Uint8Array(authDataBytes.length + clientDataHash.length);
    message.set(authDataBytes, 0);
    message.set(clientDataHash, authDataBytes.length);

    let isValid = false;
    try {
      const coseKey = parseCosePublicKey(publicKey);
      if (coseKey) {
        const publicKeyObj = await coseKeyToCryptoKey(coseKey);
        if (publicKeyObj) {
          const algorithm = algo === -257
            ? { name: 'RSASSA-PKCS1-v1_5' }
            : { name: 'ECDSA', hash: 'SHA-256' };

          isValid = await crypto.subtle.verify(
            algorithm,
            publicKeyObj,
            sigBytes,
            message
          );
        }
      }
    } catch {
      isValid = false;
    }

    if (!isValid) {
      clearPasskeyChallengeCookie(c);
      await recordLoginAttempt(c, {
        email: 'passkey-user',
        success: false,
        reason: 'passkey_signature_invalid',
        userId: (passkey as any).user_id as string
      });
      return c.json({ error: 'Invalid passkey signature' }, 401);
    }

    // Verify counter (prevent cloned authenticators)
    const storedCounter = Number((passkey as any).counter) || 0;
    const authDataCounter = parseAuthDataCounter(authenticatorData);
    if (storedCounter > 0 && authDataCounter <= storedCounter) {
      // Counter didn't increase - possible clone. Allow but warn.
      console.warn('Passkey counter did not increase:', { credentialId, storedCounter, authDataCounter });
    }

    const nowIso = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE auth_passkeys SET counter = ?, last_used_at = ? WHERE id = ?'
    ).bind(authDataCounter, nowIso, (passkey as any).id as string).run();
    clearPasskeyChallengeCookie(c);

    // Get user and create session
    const user = await c.env.DB.prepare(
      'SELECT id, username, role FROM users WHERE id = ?'
    ).bind((passkey as any).user_id as string).first();

    if (!user) {
      return c.json({ error: 'User not found' }, 401);
    }

    const userRole = normalizeRole((user as any).role);
    await createSession(c, {
      id: (user as any).id as string,
      username: (user as any).username as string,
      role: userRole
    });

    await recordAuditLog(c, {
      action: 'passkey_login_success',
      resourceType: 'auth',
      resourceId: (user as any).id as string,
      summary: `Passkey 登入成功 ${(user as any).username as string}`,
      details: {
        passkey_id: (passkey as any).id as string,
        passkey_name: ((passkey as any).name as string | null) || null,
        ip_address: getRequestIpAddress(c),
        user_agent: getRequestUserAgent(c)
      }
    });

    await recordLoginAttempt(c, {
      email: (user as any).username as string,
      success: true,
      reason: 'passkey_authenticated',
      userId: (user as any).id as string,
      role: userRole
    });

    const accountData = await getAccountById(c.env.DB, (user as any).id as string);
    return c.json({
      user: accountData?.account ?? {
        id: (user as any).id,
        username: (user as any).username,
        email: (user as any).username,
        role: userRole,
        avatar_url: null
      }
    });
  });

  app.get('/api/auth/passkeys', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await ensurePasskeysTable(c.env.DB);

    const { results } = await c.env.DB.prepare(
      'SELECT id, credential_id, algorithm, counter, device_type, backup_eligible,'
      + ' backup_state, name, last_used_at, created_at'
      + ' FROM auth_passkeys WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(sessionUser.userId).all();

    const passkeys = (results as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id),
      credential_id: String(row.credential_id),
      algorithm: Number(row.algorithm),
      counter: Number(row.counter),
      device_type: String(row.device_type),
      backup_eligible: Boolean(Number(row.backup_eligible)),
      backup_state: Boolean(Number(row.backup_state)),
      name: ((row.name as string | null) ?? null),
      last_used_at: ((row.last_used_at as string | null) ?? null),
      created_at: String(row.created_at)
    }));

    return c.json(passkeys);
  });

  app.delete('/api/auth/passkeys/:id', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await ensurePasskeysTable(c.env.DB);

    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      'SELECT id, user_id, name FROM auth_passkeys WHERE id = ?'
    ).bind(id).first();

    if (!existing) {
      return c.json({ error: 'Passkey not found' }, 404);
    }
    if ((existing as any).user_id !== sessionUser.userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Prevent removing last passkey if user has no password
    const user = await c.env.DB.prepare(
      'SELECT password_hash FROM users WHERE id = ?'
    ).bind(sessionUser.userId).first();
    const hasOtherAuth = (user as any)?.password_hash && (user as any).password_hash !== INVITE_PENDING_PASSWORD_HASH;
    const otherPasskeys = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM auth_passkeys WHERE user_id = ? AND id != ?'
    ).bind(sessionUser.userId, id).first();
    const hasOtherPasskeys = Number((otherPasskeys as any)?.count ?? 0) > 0;

    if (!hasOtherAuth && !hasOtherPasskeys) {
      return c.json({ error: 'Cannot remove last passkey when no password is set. Set a password first or register another passkey.' }, 400);
    }

    await c.env.DB.prepare('DELETE FROM auth_passkeys WHERE id = ?').bind(id).run();

    await recordAuditLog(c, {
      action: 'passkey_remove',
      resourceType: 'auth',
      resourceId: sessionUser.userId,
      summary: `移除 Passkey ${sessionUser.username}`,
      details: {
        passkey_id: id,
        passkey_name: ((existing as any).name as string | null) || null
      }
    });

    return c.json({ ok: true });
  });

  app.patch('/api/auth/passkeys/:id', async (c) => {
    const sessionUser = c.get('sessionUser');
    if (!sessionUser) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await ensurePasskeysTable(c.env.DB);

    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      'SELECT id, user_id FROM auth_passkeys WHERE id = ?'
    ).bind(id).first();

    if (!existing) {
      return c.json({ error: 'Passkey not found' }, 404);
    }
    if ((existing as any).user_id !== sessionUser.userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const body = await c.req.json();
    const name = normalizeIdentifier((body as any)?.name);
    if (!name) {
      return c.json({ error: 'name is required' }, 400);
    }

    await c.env.DB.prepare(
      'UPDATE auth_passkeys SET name = ?, updated_at = ? WHERE id = ?'
    ).bind(name, new Date().toISOString(), id).run();

    return c.json({ ok: true, name });
  });
}
