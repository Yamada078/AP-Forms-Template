-- AP+forms V5.2-C — Internal Assessment Runtime & Results
-- Published Question Pack versions are the immutable grading source of truth.

CREATE TABLE IF NOT EXISTS assessment_sessions (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  pack_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUBMITTED')),
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  FOREIGN KEY (pack_id, pack_version) REFERENCES question_pack_versions(pack_id, version) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_assessment_sessions_pack_version
  ON assessment_sessions(pack_id, pack_version, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_sessions_status
  ON assessment_sessions(status, started_at);

CREATE TABLE IF NOT EXISTS assessment_results (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  pack_id TEXT NOT NULL,
  pack_version INTEGER NOT NULL,
  submission_hash TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  grading_json TEXT NOT NULL,
  total_questions INTEGER NOT NULL,
  answered_count INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  incorrect_count INTEGER NOT NULL,
  unanswered_count INTEGER NOT NULL,
  score REAL NOT NULL,
  max_score REAL NOT NULL,
  percentage REAL NOT NULL,
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES assessment_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (pack_id, pack_version) REFERENCES question_pack_versions(pack_id, version) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_assessment_results_pack_submitted
  ON assessment_results(pack_id, pack_version, submitted_at DESC);
