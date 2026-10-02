CREATE TABLE IF NOT EXISTS application_question_packs (
  application_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (application_id, pack_id),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  FOREIGN KEY (pack_id) REFERENCES question_packs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_application_question_packs_pack
  ON application_question_packs(pack_id);
