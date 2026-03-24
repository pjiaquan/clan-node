-- Disable foreign keys temporarily to avoid issues during table swap
PRAGMA foreign_keys = OFF;

-- 1. Rename existing table
ALTER TABLE relationships RENAME TO relationships_old;

-- 2. Create new table with updated CHECK constraint
CREATE TABLE relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_person_id TEXT NOT NULL,
    to_person_id TEXT NOT NULL,
    type TEXT CHECK(type IN ('parent_child', 'spouse', 'sibling')) NOT NULL,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(from_person_id) REFERENCES people(id) ON DELETE CASCADE,
    FOREIGN KEY(to_person_id) REFERENCES people(id) ON DELETE CASCADE,
    CHECK(from_person_id != to_person_id)
);

-- 3. Copy data
INSERT INTO relationships (id, from_person_id, to_person_id, type, metadata, created_at)
SELECT id, from_person_id, to_person_id, type, metadata, created_at
FROM relationships_old;

-- 4. Recreate indexes
CREATE INDEX idx_relationships_from ON relationships(from_person_id);
CREATE INDEX idx_relationships_to ON relationships(to_person_id);
CREATE INDEX idx_relationships_type ON relationships(type);

-- 5. Drop old table
DROP TABLE relationships_old;

-- Re-enable foreign keys
PRAGMA foreign_keys = ON;
