-- Up Migration: add bot lifecycle control keys

INSERT INTO bot_config (key, value) VALUES
    ('bot_desired_state', 'running'),
    ('bot_actual_state', 'offline'),
    ('bot_restart_token', ''),
    ('bot_heartbeat_at', '')
ON CONFLICT (key) DO NOTHING;
