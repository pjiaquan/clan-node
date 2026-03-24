CREATE TABLE IF NOT EXISTS auth_rate_limits (
    action TEXT NOT NULL,
    limiter_key TEXT NOT NULL,
    window_start_ms INTEGER NOT NULL,
    count INTEGER NOT NULL,
    blocked_until_ms INTEGER,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (action, limiter_key)
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_blocked_until ON auth_rate_limits(blocked_until_ms);
