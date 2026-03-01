-- ============================================================
-- Cassandrina — TimescaleDB Schema
-- ============================================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ============================================================
-- Users (WhatsApp participants)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    whatsapp_jid    TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    accuracy        FLOAT NOT NULL DEFAULT 50.0,
    congruency      FLOAT NOT NULL DEFAULT 50.0,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Daily prediction rounds
-- ============================================================
CREATE TABLE IF NOT EXISTS prediction_rounds (
    id                      SERIAL PRIMARY KEY,
    question_date           DATE NOT NULL UNIQUE,
    target_hour             INT NOT NULL CHECK (target_hour BETWEEN 0 AND 23),
    open_at                 TIMESTAMPTZ NOT NULL,
    close_at                TIMESTAMPTZ,
    polymarket_probability  FLOAT CHECK (polymarket_probability BETWEEN 0 AND 1),
    status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'settled')),
    btc_target_price        FLOAT,
    btc_actual_price        FLOAT,
    confidence_score        FLOAT,
    strategy_used           CHAR(1) CHECK (strategy_used IN ('A', 'B', 'C', 'D', 'E'))
);

-- ============================================================
-- Individual predictions
-- ============================================================
CREATE TABLE IF NOT EXISTS predictions (
    id                  BIGSERIAL,
    round_id            INT NOT NULL REFERENCES prediction_rounds(id) ON DELETE CASCADE,
    user_id             INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    predicted_price     FLOAT NOT NULL CHECK (predicted_price > 0),
    sats_amount         INT NOT NULL CHECK (sats_amount > 0),
    lightning_invoice   TEXT,
    paid                BOOL NOT NULL DEFAULT FALSE,
    paid_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT create_hypertable('predictions', 'created_at', if_not_exists => TRUE);

-- One prediction per user per round — enforced at application layer.
-- TimescaleDB requires the partition column in unique indexes, so we
-- use a plain index here; duplicate checks happen in the API route.
CREATE INDEX IF NOT EXISTS predictions_round_user_idx
    ON predictions(round_id, user_id);

-- ============================================================
-- Trades opened by the bot
-- ============================================================
CREATE TABLE IF NOT EXISTS trades (
    id              BIGSERIAL,
    round_id        INT NOT NULL REFERENCES prediction_rounds(id) ON DELETE CASCADE,
    strategy        CHAR(1) NOT NULL CHECK (strategy IN ('A', 'B', 'C', 'D', 'E')),
    direction       TEXT NOT NULL CHECK (direction IN ('long', 'short')),
    entry_price     FLOAT NOT NULL,
    target_price    FLOAT NOT NULL,
    leverage        INT NOT NULL DEFAULT 1,
    sats_deployed   INT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'liquidated')),
    pnl_sats        INT,
    binance_order_id TEXT,
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ
);

SELECT create_hypertable('trades', 'opened_at', if_not_exists => TRUE);

-- ============================================================
-- User balance ledger
-- ============================================================
CREATE TABLE IF NOT EXISTS balance_entries (
    id          BIGSERIAL,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    round_id    INT REFERENCES prediction_rounds(id) ON DELETE SET NULL,
    delta_sats  INT NOT NULL,
    reason      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT create_hypertable('balance_entries', 'created_at', if_not_exists => TRUE);

-- ============================================================
-- Bot configuration (key-value store)
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default configuration values
INSERT INTO bot_config (key, value) VALUES
    ('prediction_target_hour', '16'),
    ('prediction_open_hour', '8'),
    ('prediction_window_hours', '6'),
    ('min_sats', '100'),
    ('max_sats', '5000'),
    ('weekly_vote_day', '6'),
    ('weekly_vote_hour', '20'),
    ('report_hours_before_target', '8'),
    ('trading_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_predictions_round_id ON predictions(round_id);
CREATE INDEX IF NOT EXISTS idx_predictions_user_id ON predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_predictions_paid ON predictions(paid);
CREATE INDEX IF NOT EXISTS idx_trades_round_id ON trades(round_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_balance_entries_user_id ON balance_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_users_whatsapp_jid ON users(whatsapp_jid);
