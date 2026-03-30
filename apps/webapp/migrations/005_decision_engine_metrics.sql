ALTER TABLE prediction_rounds
    ADD COLUMN IF NOT EXISTS user_confidence_score FLOAT,
    ADD COLUMN IF NOT EXISTS base_direction TEXT,
    ADD COLUMN IF NOT EXISTS polymarket_influence_pct FLOAT,
    ADD COLUMN IF NOT EXISTS decision_metrics JSONB;

ALTER TABLE prediction_rounds
    DROP CONSTRAINT IF EXISTS prediction_rounds_base_direction_check;

ALTER TABLE prediction_rounds
    ADD CONSTRAINT prediction_rounds_base_direction_check
    CHECK (base_direction IS NULL OR base_direction IN ('long', 'short'));

ALTER TABLE trades
    ADD COLUMN IF NOT EXISTS decision_snapshot JSONB;

INSERT INTO bot_config (key, value) VALUES
    ('pm_conf_weight_min_pct', '10'),
    ('pm_conf_weight_max_pct', '30'),
    ('pm_range_weight_min_pct', '3'),
    ('pm_range_weight_max_pct', '8'),
    ('pm_trade_window_minutes', '60'),
    ('pm_market_max_distance_pct', '5'),
    ('grid_min_width_pct', '1.5'),
    ('grid_extra_orders_width_pct', '3'),
    ('grid_balance_ratio_max', '1.25')
ON CONFLICT (key) DO NOTHING;
