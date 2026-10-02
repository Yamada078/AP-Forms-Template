-- AP+forms V5.2-B — Question Pack / Pool Foundation
-- Additive migration only. Published versions are immutable snapshots.

CREATE TABLE IF NOT EXISTS question_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  published_version INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_pack_items (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('MANUAL', 'POOL')),
  position INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (pack_id) REFERENCES question_packs(id) ON DELETE CASCADE,
  UNIQUE (pack_id, position)
);

CREATE TABLE IF NOT EXISTS question_pack_versions (
  pack_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (pack_id, version),
  FOREIGN KEY (pack_id) REFERENCES question_packs(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_question_packs_status_updated
  ON question_packs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_pack_items_pack_position
  ON question_pack_items(pack_id, position);
CREATE INDEX IF NOT EXISTS idx_question_pack_versions_published
  ON question_pack_versions(pack_id, version DESC);
