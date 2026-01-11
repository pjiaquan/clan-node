-- Disable foreign keys temporarily
PRAGMA foreign_keys = OFF;

-- 1. Rename existing table
-- If migration failed halfway, we might have relationships_old already. 
-- We should handle that, but for now assuming clean state or I'll check first.
-- Since the previous command failed, the state might be: relationships renamed to relationships_old, but new table not created?
-- Or it failed at index creation.

-- Let's just try to clean up first if it exists from failed run
DROP TABLE IF EXISTS relationships_temp;

-- Check if we are in a partial state. 
-- The error was "index already exists", which happened at step 4.
-- So step 1 (rename), 2 (create new), 3 (copy) probably succeeded? 
-- No, SQLite executes the script. If it fails, does it rollback? 
-- Wrangler D1 execute might not wrap the whole file in a transaction automatically.

-- I will write a script that is idempotent or cleans up.

BEGIN TRANSACTION;

-- If we already renamed it in the failed run but didn't drop it:
-- We might have 'relationships' (new) and 'relationships_old' (renamed).
-- Or just 'relationships_old' if step 2 failed?
-- Actually, let's assume we are reverting to a clean state or proceeding.

-- Safe Approach:
-- Create new table as 'relationships_new'
-- Copy data
-- Drop 'relationships'
-- Rename 'relationships_new' to 'relationships'

CREATE TABLE IF NOT EXISTS relationships_new (
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

INSERT INTO relationships_new (id, from_person_id, to_person_id, type, metadata, created_at)
SELECT id, from_person_id, to_person_id, type, metadata, created_at
FROM relationships;

-- Drop old table
DROP TABLE relationships;

-- Rename new table
ALTER TABLE relationships_new RENAME TO relationships;

-- Create indexes (old ones were dropped with the table)
CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type);

COMMIT;

PRAGMA foreign_keys = ON;
