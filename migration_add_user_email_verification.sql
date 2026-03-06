ALTER TABLE users ADD COLUMN email TEXT;
UPDATE users SET email = LOWER(TRIM(username)) WHERE email IS NULL OR TRIM(email) = '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email);

ALTER TABLE users ADD COLUMN email_verified_at TEXT;
UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at);

ALTER TABLE users ADD COLUMN email_verify_token_hash TEXT;
ALTER TABLE users ADD COLUMN email_verify_expires_at TEXT;
