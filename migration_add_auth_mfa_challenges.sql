CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_user ON auth_mfa_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_expires_at ON auth_mfa_challenges(expires_at);
