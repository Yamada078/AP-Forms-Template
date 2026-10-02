-- AP+forms: initialize an empty database once.
-- For existing databases, use the required additive migrations instead.

-- schema.sql
CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  respondent_name TEXT NOT NULL,
  respondent_meta TEXT,
  answers TEXT NOT NULL,
  path TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_forms_updated_at ON forms(updated_at);
CREATE INDEX IF NOT EXISTS idx_responses_form_id ON responses(form_id);
CREATE INDEX IF NOT EXISTS idx_responses_created_at ON responses(created_at);

-- migrations/0001_publish_system.sql
ALTER TABLE forms ADD COLUMN public_id TEXT;
ALTER TABLE forms ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'DRAFT'
  CHECK (publication_state IN ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'ARCHIVED'));
ALTER TABLE forms ADD COLUMN published_data TEXT;
ALTER TABLE forms ADD COLUMN published_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN published_at TEXT;
ALTER TABLE forms ADD COLUMN open_at TEXT;
ALTER TABLE forms ADD COLUMN close_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forms_public_id
  ON forms(public_id)
  WHERE public_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS form_versions (
  form_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (form_id, version),
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_form_versions_form_id
  ON form_versions(form_id, version DESC);

CREATE TABLE IF NOT EXISTS revoked_public_links (
  public_id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  revoked_at TEXT NOT NULL
);

ALTER TABLE responses ADD COLUMN published_version INTEGER;
CREATE INDEX IF NOT EXISTS idx_responses_form_version
  ON responses(form_id, published_version);

UPDATE forms
SET publication_state = 'OPEN',
    published_data = data,
    published_version = 1,
    published_at = COALESCE(updated_at, created_at)
WHERE published = 1
  AND published_data IS NULL;

INSERT OR IGNORE INTO form_versions (form_id, version, data, published_at)
SELECT id, 1, published_data, published_at
FROM forms
WHERE published_version = 1
  AND published_data IS NOT NULL;

UPDATE responses
SET published_version = 1
WHERE published_version IS NULL
  AND form_id IN (SELECT id FROM forms WHERE published_version >= 1);

-- migrations/0003_integration_foundation.sql
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'DISABLED', 'REVOKED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_applications_status
  ON applications(status);

CREATE TABLE IF NOT EXISTS integration_credentials (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  label TEXT,
  secret_hash TEXT NOT NULL,
  secret_prefix TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_credentials_secret_hash
  ON integration_credentials(secret_hash);
CREATE INDEX IF NOT EXISTS idx_integration_credentials_application
  ON integration_credentials(application_id, status);

CREATE TABLE IF NOT EXISTS application_permissions (
  application_id TEXT NOT NULL,
  capability TEXT NOT NULL
    CHECK (capability IN (
      'read_form_schema',
      'submit_response',
      'read_question_pack',
      'submit_game_result',
      'read_responses'
    )),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (application_id, capability),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_application_permissions_capability
  ON application_permissions(capability, application_id);

ALTER TABLE responses ADD COLUMN source TEXT NOT NULL DEFAULT 'public_form';
ALTER TABLE responses ADD COLUMN source_app_id TEXT;
ALTER TABLE responses ADD COLUMN source_version TEXT;
ALTER TABLE responses ADD COLUMN source_session TEXT;
ALTER TABLE responses ADD COLUMN source_platform TEXT;
ALTER TABLE responses ADD COLUMN source_metadata TEXT;

CREATE INDEX IF NOT EXISTS idx_responses_source
  ON responses(source, source_app_id);
CREATE INDEX IF NOT EXISTS idx_responses_source_version
  ON responses(source_app_id, source_version);

-- migrations/0004_application_form_access.sql
CREATE TABLE IF NOT EXISTS application_forms (
  application_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (application_id, form_id),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_application_forms_form
  ON application_forms(form_id, application_id);

-- migrations/0005_question_bank_foundation.sql
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

-- migrations/0006_question_pack_foundation.sql
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

-- migrations/0007_assessment_runtime_results.sql
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

-- migrations/0008_question_activity_media.sql
-- AP+forms — Question activities and versioned static media references
-- Additive only: the legacy type column and its CHECK remain untouched.

ALTER TABLE bank_questions ADD COLUMN activity_type TEXT
  CHECK (activity_type IS NULL OR activity_type IN ('ORDERING', 'MATCHING', 'DRAG_DROP'));

ALTER TABLE bank_questions ADD COLUMN media_json TEXT NOT NULL DEFAULT 'null';

CREATE INDEX IF NOT EXISTS idx_bank_questions_bank_activity_type
  ON bank_questions(bank_id, activity_type, updated_at DESC);

-- Existing complete drafts become ready without changing archived questions.
-- The physical type column is retained for full compatibility with the old CHECK.
UPDATE bank_questions
SET status = 'READY'
WHERE status = 'DRAFT'
  AND TRIM(prompt) <> ''
  AND (
    (type IN ('SINGLE_CHOICE', 'MULTIPLE_CHOICE')
      AND (SELECT COUNT(*) FROM json_each(answer_config, '$.choices') WHERE TRIM(COALESCE(json_extract(value, '$.text'), '')) <> '') >= 2
      AND json_array_length(COALESCE(json_extract(answer_config, '$.correctIds'), '[]')) >= 1
      AND (type <> 'SINGLE_CHOICE' OR json_array_length(COALESCE(json_extract(answer_config, '$.correctIds'), '[]')) = 1))
    OR (type = 'TRUE_FALSE' AND json_type(answer_config, '$.correctAnswer') IN ('true', 'false'))
    OR (type = 'SHORT_ANSWER'
      AND (SELECT COUNT(*) FROM json_each(answer_config, '$.acceptedAnswers') WHERE TRIM(COALESCE(value, '')) <> '') >= 1)
  );

-- migrations/0009_question_pack_integration.sql
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

-- migrations/0010_organization_accounts.sql
CREATE TABLE organization (
  id INTEGER PRIMARY KEY CHECK (id=1),
  name TEXT NOT NULL,
  logo_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE organization_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','EDITOR','RESPONDENT')),
  status TEXT NOT NULL CHECK (status IN ('INVITED','ACTIVE','DISABLED')),
  created_at TEXT NOT NULL
);
CREATE TABLE organization_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES organization_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_organization_sessions_user ON organization_sessions(user_id);
CREATE TABLE organization_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES organization_users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('INVITE','RESET')),
  expires_at TEXT NOT NULL
);
CREATE TABLE organization_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
ALTER TABLE forms ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (access_mode IN ('PUBLIC','MEMBERS','SELECTED'));
CREATE TABLE form_members (
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES organization_users(id) ON DELETE CASCADE,
  PRIMARY KEY (form_id,user_id)
);
ALTER TABLE responses ADD COLUMN respondent_user_id TEXT REFERENCES organization_users(id);
