ALTER TABLE users
  ALTER COLUMN accuracy SET DEFAULT 0.5,
  ALTER COLUMN congruency SET DEFAULT 0.5;

UPDATE users
SET
  accuracy = LEAST(GREATEST(CASE WHEN accuracy > 1 THEN accuracy / 100.0 ELSE accuracy END, 0.1), 1.0),
  congruency = LEAST(GREATEST(CASE WHEN congruency > 1 THEN congruency / 100.0 ELSE congruency END, 0.1), 1.0);

UPDATE prediction_rounds
SET confidence_score = LEAST(GREATEST(confidence_score / 100.0, 0.1), 1.0)
WHERE confidence_score IS NOT NULL
  AND confidence_score > 1;
