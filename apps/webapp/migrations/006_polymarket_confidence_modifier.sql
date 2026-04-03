INSERT INTO bot_config (key, value) VALUES
    ('pm_conf_weight_min_pct', '10'),
    ('pm_conf_weight_max_pct', '30'),
    ('pm_trade_window_minutes', '60'),
    ('pm_market_max_distance_pct', '5')
ON CONFLICT (key) DO NOTHING;
