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
