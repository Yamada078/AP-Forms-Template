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
