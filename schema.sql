-- Family Tree Database Schema for Cloudflare D1

-- People table: stores individual persons (nodes in the graph)
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    english_name TEXT,
    gender TEXT CHECK(gender IN ('M', 'F', 'O')) NOT NULL DEFAULT 'O',
    dob TEXT, -- ISO date string for age comparison (older/younger sibling)
    dod TEXT, -- ISO date string for time of death date
    tob TEXT, -- HH:MM 24h string for time of birth
    tod TEXT, -- HH:MM 24h string for time of death
    avatar_url TEXT,
    metadata TEXT, -- JSON for additional fields
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Relationships table: stores connections between people (edges in the graph)
CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_person_id TEXT NOT NULL,
    to_person_id TEXT NOT NULL,
    type TEXT CHECK(type IN ('parent_child', 'spouse', 'ex_spouse', 'sibling', 'in_law')) NOT NULL,
    metadata TEXT, -- JSON for: adopted, divorced, etc.
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(from_person_id) REFERENCES people(id) ON DELETE CASCADE,
    FOREIGN KEY(to_person_id) REFERENCES people(id) ON DELETE CASCADE,
    CHECK(from_person_id != to_person_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type);

-- Relationship type labels table: stores editable display names for core relationship types
CREATE TABLE IF NOT EXISTS relationship_type_labels (
    type TEXT PRIMARY KEY CHECK(type IN ('parent_child', 'spouse', 'ex_spouse', 'sibling', 'in_law')),
    label TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO relationship_type_labels (type, label, description) VALUES
    ('parent_child', '親子', '父母與子女關係'),
    ('spouse', '夫妻', '現任配偶關係'),
    ('ex_spouse', '前配偶', '曾為配偶關係'),
    ('sibling', '手足', '兄弟姐妹關係'),
    ('in_law', '姻親', '婚姻延伸關係');

-- Custom fields table: stores editable label/value pairs for each person
CREATE TABLE IF NOT EXISTS person_custom_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_person_custom_fields_person ON person_custom_fields(person_id);
CREATE INDEX IF NOT EXISTS idx_person_custom_fields_label ON person_custom_fields(label);

-- Users table: stores admin login
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Sessions table: stores login sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    last_seen_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Notifications table: readonly users can report requested changes for admin handling
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

-- Audit logs table: stores write-operation history for admin review
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id TEXT,
    actor_username TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    summary TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);

-- Sample data for testing
INSERT OR IGNORE INTO people (id, name, gender, dob) VALUES
    ('11111111-1111-4111-8111-111111111111', '我', 'M', '1990-01-01'),
    ('22222222-2222-4222-8222-222222222222', '父親', 'M', '1965-05-15'),
    ('33333333-3333-4333-8333-333333333333', '母親', 'F', '1968-08-20'),
    ('44444444-4444-4444-8444-444444444444', '祖父', 'M', '1940-03-10'),
    ('55555555-5555-4555-8555-555555555555', '祖母', 'F', '1942-07-25'),
    ('66666666-6666-4666-8666-666666666666', '叔叔', 'M', '1970-12-01'),
    ('77777777-7777-4777-8777-777777777777', '阿姨', 'F', '1972-04-12');

INSERT OR IGNORE INTO relationships (from_person_id, to_person_id, type) VALUES
    -- My parents
    ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'parent_child'),  -- father -> me
    ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'parent_child'),  -- mother -> me
    ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'spouse'),        -- father & mother married
    -- My grandparents (father's side)
    ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'parent_child'),  -- grandfather -> father
    ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'parent_child'),  -- grandmother -> father
    ('44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', 'spouse'),        -- grandparents married
    -- My uncle and aunt (father's siblings)
    ('44444444-4444-4444-8444-444444444444', '66666666-6666-4666-8666-666666666666', 'parent_child'),  -- grandfather -> uncle
    ('55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', 'parent_child'),  -- grandmother -> uncle
    ('44444444-4444-4444-8444-444444444444', '77777777-7777-4777-8777-777777777777', 'parent_child'),  -- grandfather -> aunt
    ('55555555-5555-4555-8555-555555555555', '77777777-7777-4777-8777-777777777777', 'parent_child');  -- grandmother -> aunt
