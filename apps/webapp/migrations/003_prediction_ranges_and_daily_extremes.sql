-- Up Migration: prediction low/high ranges and round daily extremes

ALTER TABLE prediction_rounds
    ADD COLUMN IF NOT EXISTS btc_target_low_price FLOAT,
    ADD COLUMN IF NOT EXISTS btc_target_high_price FLOAT,
    ADD COLUMN IF NOT EXISTS btc_actual_low_price FLOAT,
    ADD COLUMN IF NOT EXISTS btc_actual_high_price FLOAT;

ALTER TABLE predictions
    ADD COLUMN IF NOT EXISTS predicted_low_price FLOAT,
    ADD COLUMN IF NOT EXISTS predicted_high_price FLOAT;

UPDATE predictions
SET predicted_low_price = COALESCE(predicted_low_price, predicted_price),
    predicted_high_price = COALESCE(predicted_high_price, predicted_price)
WHERE predicted_low_price IS NULL
   OR predicted_high_price IS NULL;

ALTER TABLE predictions
    ALTER COLUMN predicted_low_price SET NOT NULL,
    ALTER COLUMN predicted_high_price SET NOT NULL;

ALTER TABLE predictions
    DROP CONSTRAINT IF EXISTS predictions_predicted_low_price_check,
    DROP CONSTRAINT IF EXISTS predictions_predicted_high_price_check;

ALTER TABLE predictions
    ADD CONSTRAINT predictions_predicted_low_price_check CHECK (predicted_low_price > 0),
    ADD CONSTRAINT predictions_predicted_high_price_check CHECK (predicted_high_price >= predicted_low_price);
