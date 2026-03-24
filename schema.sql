-- Family Tree Database Schema for Cloudflare D1

-- People table: stores individual persons (nodes in the graph)
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    english_name TEXT,
    email TEXT,
    gender TEXT CHECK(gender IN ('M', 'F', 'O')) NOT NULL DEFAULT 'O',
    blood_type TEXT, -- ABO blood type (A/B/O/AB), nullable
    dob TEXT, -- ISO date string for age comparison (older/younger sibling)
    dod TEXT, -- ISO date string for time of death date
    tob TEXT, -- HH:MM 24h string for time of birth
    tod TEXT, -- HH:MM 24h string for time of death
    avatar_url TEXT,
    metadata TEXT, -- JSON for additional fields
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Person avatars table: stores multiple avatars per person (with one primary)
CREATE TABLE IF NOT EXISTS person_avatars (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    avatar_url TEXT NOT NULL,
    storage_key TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_person_avatars_person ON person_avatars(person_id, sort_order, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_person_primary_avatar ON person_avatars(person_id) WHERE is_primary = 1;

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

-- Kinship labels table: stores editable display labels for calculated titles
CREATE TABLE IF NOT EXISTS kinship_labels (
    default_title TEXT NOT NULL,
    default_formal_title TEXT NOT NULL,
    custom_title TEXT,
    custom_formal_title TEXT,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (default_title, default_formal_title)
);

INSERT OR IGNORE INTO kinship_labels (
    default_title, default_formal_title, custom_title, custom_formal_title, description
) VALUES
    ('我', '我', NULL, NULL, '自己'),
    ('父親', '父親', NULL, NULL, '爸爸'),
    ('母親', '母親', NULL, NULL, '媽媽'),
    ('爺爺', '爺爺', NULL, NULL, '父系祖父'),
    ('奶奶', '奶奶', NULL, NULL, '父系祖母'),
    ('外公', '外公', NULL, NULL, '母系祖父'),
    ('外婆', '外婆', NULL, NULL, '母系祖母'),
    ('丈夫', '丈夫', NULL, NULL, '男性配偶稱呼'),
    ('妻子', '妻子', NULL, NULL, '女性配偶稱呼'),
    ('前夫', '前夫', NULL, NULL, '過往婚姻男性配偶'),
    ('前妻', '前妻', NULL, NULL, '過往婚姻女性配偶'),
    ('哥哥', '哥哥', NULL, NULL, '男性年長手足'),
    ('弟弟', '弟弟', NULL, NULL, '男性年幼手足'),
    ('姐姐', '姐姐', NULL, NULL, '女性年長手足'),
    ('妹妹', '妹妹', NULL, NULL, '女性年幼手足'),
    ('伯父', '伯父', NULL, NULL, '父親年長兄弟'),
    ('叔叔', '叔叔', NULL, NULL, '父親年幼兄弟'),
    ('姑姑', '姑姑', NULL, NULL, '父親姊妹'),
    ('舅舅', '舅舅', NULL, NULL, '母親兄弟'),
    ('阿姨', '阿姨', NULL, NULL, '母親姊妹'),
    ('伯母', '伯母', NULL, NULL, '伯父配偶'),
    ('嬸嬸', '嬸嬸', NULL, NULL, '叔叔配偶'),
    ('姑丈', '姑丈', NULL, NULL, '姑姑配偶'),
    ('舅媽', '舅媽', NULL, NULL, '舅舅配偶'),
    ('姨丈', '姨丈', NULL, NULL, '阿姨配偶'),
    ('兒子', '兒子', NULL, NULL, '男性子女'),
    ('女兒', '女兒', NULL, NULL, '女性子女'),
    ('媳婦', '媳婦', NULL, NULL, '兒子配偶'),
    ('女婿', '女婿', NULL, NULL, '女兒配偶'),
    ('孫子', '孫子', NULL, NULL, '子女的男性子女'),
    ('孫女', '孫女', NULL, NULL, '子女的女性子女'),
    ('外孫', '外孫', NULL, NULL, '外家第三代男性'),
    ('外孫女', '外孫女', NULL, NULL, '外家第三代女性');

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
    email TEXT NOT NULL UNIQUE,
    email_verified_at TEXT,
    email_verify_token_hash TEXT,
    email_verify_expires_at TEXT,
    mfa_totp_secret TEXT,
    mfa_totp_enabled_at TEXT,
    mfa_totp_pending_secret TEXT,
    mfa_totp_pending_expires_at TEXT,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email);

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

-- Auth rate limits table: stores login/resend throttling counters and block windows
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

-- MFA challenge table: stores short-lived email OTP login challenges
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

-- MFA session table: stores password-verified pending MFA steps
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
