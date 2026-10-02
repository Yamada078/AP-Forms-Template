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
