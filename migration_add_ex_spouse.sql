CREATE TABLE IF NOT EXISTS relationships_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_person_id TEXT NOT NULL,
    to_person_id TEXT NOT NULL,
    type TEXT CHECK(type IN ('parent_child', 'spouse', 'ex_spouse', 'sibling', 'in_law')) NOT NULL,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(from_person_id) REFERENCES people(id) ON DELETE CASCADE,
    FOREIGN KEY(to_person_id) REFERENCES people(id) ON DELETE CASCADE,
    CHECK(from_person_id != to_person_id)
);

INSERT INTO relationships_new (id, from_person_id, to_person_id, type, metadata, created_at)
SELECT id, from_person_id, to_person_id, type, metadata, created_at
FROM relationships;

DROP TABLE relationships;
ALTER TABLE relationships_new RENAME TO relationships;

CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type);
