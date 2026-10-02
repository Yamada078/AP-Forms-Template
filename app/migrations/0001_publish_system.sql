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
