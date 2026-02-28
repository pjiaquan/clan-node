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
