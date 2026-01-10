-- Family Tree Database Schema for Cloudflare D1

-- People table: stores individual persons (nodes in the graph)
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gender TEXT CHECK(gender IN ('M', 'F', 'O')) NOT NULL DEFAULT 'O',
    dob TEXT, -- ISO date string for age comparison (older/younger sibling)
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
    type TEXT CHECK(type IN ('parent_child', 'spouse')) NOT NULL,
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

-- Sample data for testing
INSERT OR IGNORE INTO people (id, name, gender, dob) VALUES
    ('1', '我', 'M', '1990-01-01'),
    ('2', '父親', 'M', '1965-05-15'),
    ('3', '母親', 'F', '1968-08-20'),
    ('4', '祖父', 'M', '1940-03-10'),
    ('5', '祖母', 'F', '1942-07-25'),
    ('6', '叔叔', 'M', '1970-12-01'),
    ('7', '阿姨', 'F', '1972-04-12');

INSERT OR IGNORE INTO relationships (from_person_id, to_person_id, type) VALUES
    -- My parents
    ('2', '1', 'parent_child'),  -- father -> me
    ('3', '1', 'parent_child'),  -- mother -> me
    ('2', '3', 'spouse'),        -- father & mother married
    -- My grandparents (father's side)
    ('4', '2', 'parent_child'),  -- grandfather -> father
    ('5', '2', 'parent_child'),  -- grandmother -> father
    ('4', '5', 'spouse'),        -- grandparents married
    -- My uncle and aunt (father's siblings)
    ('4', '6', 'parent_child'),  -- grandfather -> uncle
    ('5', '6', 'parent_child'),  -- grandmother -> uncle
    ('4', '7', 'parent_child'),  -- grandfather -> aunt
    ('5', '7', 'parent_child');  -- grandmother -> aunt
