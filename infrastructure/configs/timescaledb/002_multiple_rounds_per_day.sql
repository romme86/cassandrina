DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'prediction_rounds_question_date_key'
    ) THEN
        ALTER TABLE prediction_rounds
            DROP CONSTRAINT prediction_rounds_question_date_key;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prediction_rounds_question_date
    ON prediction_rounds(question_date);
