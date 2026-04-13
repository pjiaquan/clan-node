-- Passkey (WebAuthn) authentication credentials
CREATE TABLE IF NOT EXISTS auth_passkeys (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_passkeys_credential_id ON auth_passkeys(credential_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON auth_passkeys(user_id);
