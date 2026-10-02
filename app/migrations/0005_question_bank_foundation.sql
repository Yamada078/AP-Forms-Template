-- AP+forms V5.2-A — Question Bank Foundation
-- Additive migration only. Apply to local/production D1 explicitly after review.

CREATE TABLE IF NOT EXISTS question_banks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_questions (
  id TEXT PRIMARY KEY,
  bank_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER')),
  prompt TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY', 'ARCHIVED')),
  answer_config TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  source_reference TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS question_tags (
  id TEXT PRIMARY KEY,
  bank_id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  group_name TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE CASCADE,
  UNIQUE (bank_id, group_name, name)
);

CREATE TABLE IF NOT EXISTS question_tag_links (
  question_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (question_id, tag_id),
  FOREIGN KEY (question_id) REFERENCES bank_questions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES question_tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_question_banks_status_updated
  ON question_banks(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_questions_bank_updated
  ON bank_questions(bank_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_questions_bank_status
  ON bank_questions(bank_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_questions_bank_type
  ON bank_questions(bank_id, type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_questions_bank_difficulty
  ON bank_questions(bank_id, difficulty, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_tags_bank
  ON question_tags(bank_id, group_name, name);
CREATE INDEX IF NOT EXISTS idx_question_tag_links_tag
  ON question_tag_links(tag_id, question_id);
