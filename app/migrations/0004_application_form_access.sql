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
