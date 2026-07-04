BEGIN;

ALTER TABLE ticket_ratings
  DROP CONSTRAINT IF EXISTS ticket_ratings_comment_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ticket_ratings_comment_not_blank_check'
      AND conrelid = 'ticket_ratings'::regclass
  ) THEN
    ALTER TABLE ticket_ratings
      ADD CONSTRAINT ticket_ratings_comment_not_blank_check
      CHECK (length(trim(comment)) >= 1);
  END IF;
END $$;

COMMIT;
