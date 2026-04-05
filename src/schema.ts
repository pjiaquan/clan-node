export type PeopleSchemaSupport = {
  hasEmail: boolean;
};

export type UserSchemaSupport = {
  hasEmail: boolean;
  hasEmailVerifiedAt: boolean;
  hasEmailVerifyTokenHash: boolean;
  hasEmailVerifyExpiresAt: boolean;
  hasAvatarUrl: boolean;
  hasMfaTotpSecret: boolean;
  hasMfaTotpEnabledAt: boolean;
  hasMfaTotpPendingSecret: boolean;
  hasMfaTotpPendingExpiresAt: boolean;
};

let peopleSchemaSupportPromise: Promise<PeopleSchemaSupport> | null = null;
let userSchemaSupportPromise: Promise<UserSchemaSupport> | null = null;

const listColumnNames = async (db: D1Database, table: string) => {
  const pragma = await db.prepare(`PRAGMA table_info('${table}')`).all();
  return new Set(
    (pragma.results as Array<Record<string, unknown>>)
      .map((row) => String(row.name ?? ''))
      .filter(Boolean)
  );
};

const addColumnIfMissing = async (
  db: D1Database,
  existing: Set<string>,
  table: string,
  column: string,
  ddl: string,
) => {
  if (existing.has(column)) return;
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
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

export const getPeopleSchemaSupport = async (db: D1Database): Promise<PeopleSchemaSupport> => {
  if (!peopleSchemaSupportPromise) {
    peopleSchemaSupportPromise = (async () => {
      const names = await listColumnNames(db, 'people');
      await addColumnIfMissing(db, names, 'people', 'email', 'email TEXT');
      return { hasEmail: names.has('email') };
    })().catch((error) => {
      peopleSchemaSupportPromise = null;
      throw error;
    });
  }
  return peopleSchemaSupportPromise;
};

export const getUserSchemaSupport = async (db: D1Database): Promise<UserSchemaSupport> => {
  if (!userSchemaSupportPromise) {
    userSchemaSupportPromise = (async () => {
      const names = await listColumnNames(db, 'users');
      await addColumnIfMissing(db, names, 'users', 'email', 'email TEXT');
      await addColumnIfMissing(db, names, 'users', 'email_verified_at', 'email_verified_at TEXT');
      await addColumnIfMissing(db, names, 'users', 'email_verify_token_hash', 'email_verify_token_hash TEXT');
      await addColumnIfMissing(db, names, 'users', 'email_verify_expires_at', 'email_verify_expires_at TEXT');
      await addColumnIfMissing(db, names, 'users', 'avatar_url', 'avatar_url TEXT');
      await addColumnIfMissing(db, names, 'users', 'mfa_totp_secret', 'mfa_totp_secret TEXT');
      await addColumnIfMissing(db, names, 'users', 'mfa_totp_enabled_at', 'mfa_totp_enabled_at TEXT');
      await addColumnIfMissing(db, names, 'users', 'mfa_totp_pending_secret', 'mfa_totp_pending_secret TEXT');
      await addColumnIfMissing(db, names, 'users', 'mfa_totp_pending_expires_at', 'mfa_totp_pending_expires_at TEXT');
      if (names.has('email')) {
        await db.prepare("UPDATE users SET email = LOWER(TRIM(username)) WHERE email IS NULL OR TRIM(email) = ''").run();
        await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email)').run();
      }
      return {
        hasEmail: names.has('email'),
        hasEmailVerifiedAt: names.has('email_verified_at'),
        hasEmailVerifyTokenHash: names.has('email_verify_token_hash'),
        hasEmailVerifyExpiresAt: names.has('email_verify_expires_at'),
        hasAvatarUrl: names.has('avatar_url'),
        hasMfaTotpSecret: names.has('mfa_totp_secret'),
        hasMfaTotpEnabledAt: names.has('mfa_totp_enabled_at'),
        hasMfaTotpPendingSecret: names.has('mfa_totp_pending_secret'),
        hasMfaTotpPendingExpiresAt: names.has('mfa_totp_pending_expires_at'),
      };
    })().catch((error) => {
      userSchemaSupportPromise = null;
      throw error;
    });
  }
  return userSchemaSupportPromise;
};
