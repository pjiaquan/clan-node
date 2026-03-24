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
