ALTER TABLE predictions
    ADD COLUMN IF NOT EXISTS telegram_group_chat_id TEXT,
    ADD COLUMN IF NOT EXISTS telegram_group_name TEXT;

CREATE INDEX IF NOT EXISTS idx_predictions_telegram_group_chat_id
    ON predictions(telegram_group_chat_id);

CREATE INDEX IF NOT EXISTS idx_predictions_telegram_group_name
    ON predictions(telegram_group_name);
