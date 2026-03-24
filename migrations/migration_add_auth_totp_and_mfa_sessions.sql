ALTER TABLE users ADD COLUMN mfa_totp_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_totp_enabled_at TEXT;
ALTER TABLE users ADD COLUMN mfa_totp_pending_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_totp_pending_expires_at TEXT;

CREATE TABLE IF NOT EXISTS auth_mfa_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_sessions_user ON auth_mfa_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_mfa_sessions_expires_at ON auth_mfa_sessions(expires_at);
