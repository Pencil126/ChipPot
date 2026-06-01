-- Rename channel_tags.type value 'linepay' -> 'mobilepayment' (an umbrella category for mobile
-- payments: LINE Pay, iPass Money, etc.; new channels are new rows under this same type, no
-- further migration needed). Changing a CHECK constraint requires rebuilding the table.
-- Safe: ids are preserved, and payments referencing channel_tags is empty at apply time.
PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE channel_tags_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('mobilepayment','bank','other')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

INSERT INTO channel_tags_new (id, workspace_id, name, type, active, sort_order, created_at)
SELECT id, workspace_id, name,
       CASE type WHEN 'linepay' THEN 'mobilepayment' ELSE type END,
       active, sort_order, created_at
FROM channel_tags;

DROP TABLE channel_tags;
ALTER TABLE channel_tags_new RENAME TO channel_tags;
