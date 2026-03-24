CREATE TABLE IF NOT EXISTS graph_layers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE people ADD COLUMN layer_id TEXT;
ALTER TABLE relationships ADD COLUMN layer_id TEXT;

INSERT OR IGNORE INTO graph_layers (id, name, description)
VALUES ('default', 'Default Layer', 'Migrated default graph layer');

UPDATE people SET layer_id = 'default' WHERE layer_id IS NULL OR TRIM(layer_id) = '';
UPDATE relationships SET layer_id = 'default' WHERE layer_id IS NULL OR TRIM(layer_id) = '';

CREATE INDEX IF NOT EXISTS idx_people_layer_id ON people(layer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_relationships_layer_id ON relationships(layer_id, created_at);
