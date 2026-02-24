CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('rename', 'avatar', 'relationship', 'other')),
    target_person_id TEXT,
    target_person_name TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'resolved', 'rejected')),
    created_by_user_id TEXT NOT NULL,
    created_by_username TEXT NOT NULL,
    resolved_by_user_id TEXT,
    resolved_by_username TEXT,
    resolved_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(target_person_id) REFERENCES people(id) ON DELETE SET NULL,
    FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_target_person ON notifications(target_person_id);
