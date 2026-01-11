BEGIN TRANSACTION;
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS people_uuid_map (
    old_id TEXT PRIMARY KEY,
    new_id TEXT NOT NULL
);

INSERT INTO people_uuid_map (old_id, new_id)
SELECT
    id,
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6)))
FROM people;

CREATE TABLE people_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gender TEXT CHECK(gender IN ('M', 'F', 'O')) NOT NULL DEFAULT 'O',
    dob TEXT,
    dod TEXT,
    tob TEXT,
    tod TEXT,
    avatar_url TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO people_new (id, name, gender, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at)
SELECT
    map.new_id,
    p.name,
    p.gender,
    p.dob,
    p.dod,
    p.tob,
    p.tod,
    p.avatar_url,
    p.metadata,
    p.created_at,
    p.updated_at
FROM people p
JOIN people_uuid_map map ON map.old_id = p.id;

ALTER TABLE people RENAME TO people_old;
ALTER TABLE people_new RENAME TO people;

CREATE TABLE relationships_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_person_id TEXT NOT NULL,
    to_person_id TEXT NOT NULL,
    type TEXT CHECK(type IN ('parent_child', 'spouse', 'sibling', 'in_law')) NOT NULL,
    metadata TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(from_person_id) REFERENCES people(id) ON DELETE CASCADE,
    FOREIGN KEY(to_person_id) REFERENCES people(id) ON DELETE CASCADE,
    CHECK(from_person_id != to_person_id)
);

INSERT INTO relationships_new (id, from_person_id, to_person_id, type, metadata, created_at)
SELECT
    r.id,
    map_from.new_id,
    map_to.new_id,
    r.type,
    r.metadata,
    r.created_at
FROM relationships r
JOIN people_uuid_map map_from ON map_from.old_id = r.from_person_id
JOIN people_uuid_map map_to ON map_to.old_id = r.to_person_id;

DROP TABLE relationships;
ALTER TABLE relationships_new RENAME TO relationships;

DROP TABLE people_old;
DROP TABLE people_uuid_map;

CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type);

PRAGMA foreign_keys = ON;
COMMIT;
