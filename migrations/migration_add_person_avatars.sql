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

INSERT INTO person_avatars (
    id,
    person_id,
    avatar_url,
    storage_key,
    is_primary,
    sort_order,
    created_at,
    updated_at
)
SELECT
    lower(hex(randomblob(16))) AS id,
    p.id,
    p.avatar_url,
    CASE
        WHEN p.avatar_url LIKE '/api/avatars/%' THEN substr(p.avatar_url, 14)
        ELSE NULL
    END AS storage_key,
    1 AS is_primary,
    0 AS sort_order,
    COALESCE(p.updated_at, datetime('now')),
    COALESCE(p.updated_at, datetime('now'))
FROM people p
WHERE p.avatar_url IS NOT NULL
  AND trim(p.avatar_url) <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM person_avatars pa
      WHERE pa.person_id = p.id
  );

UPDATE people
SET avatar_url = (
    SELECT pa.avatar_url
    FROM person_avatars pa
    WHERE pa.person_id = people.id
      AND pa.is_primary = 1
    ORDER BY pa.sort_order ASC, pa.created_at ASC
    LIMIT 1
)
WHERE EXISTS (
    SELECT 1
    FROM person_avatars pa
    WHERE pa.person_id = people.id
);
