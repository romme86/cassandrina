-- ============================================================
-- Cassandrina — TimescaleDB Schema
-- ============================================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ============================================================
-- Users (chat participants)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    platform        TEXT NOT NULL,
    platform_user_id TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    accuracy        FLOAT NOT NULL DEFAULT 0.5,
    congruency      FLOAT NOT NULL DEFAULT 0.5,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, platform_user_id)
);

-- ============================================================
-- Polymarket BTC participant snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS polymarket_bitcoiners (
    id                  BIGSERIAL PRIMARY KEY,
    snapshot_date       DATE NOT NULL,
    captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    market_condition_id TEXT NOT NULL,
    market_slug         TEXT,
    market_question     TEXT NOT NULL,
    market_end_date     TIMESTAMPTZ,
    proxy_wallet        TEXT NOT NULL,
    display_name        TEXT,
    profile_image       TEXT,
    verified            BOOL NOT NULL DEFAULT FALSE,
    outcomes            TEXT[] NOT NULL DEFAULT '{}',
    total_bought        FLOAT NOT NULL DEFAULT 0,
    avg_price           FLOAT,
    size                FLOAT NOT NULL DEFAULT 0,
    current_price       FLOAT,
    current_value       FLOAT NOT NULL DEFAULT 0,
    cash_pnl            FLOAT NOT NULL DEFAULT 0,
    realized_pnl        FLOAT NOT NULL DEFAULT 0,
    total_pnl           FLOAT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (snapshot_date, market_condition_id, proxy_wallet)
);

-- ============================================================
-- Daily prediction rounds
-- ============================================================
CREATE TABLE IF NOT EXISTS prediction_rounds (
    id                      SERIAL PRIMARY KEY,
    question_date           DATE NOT NULL,
    target_hour             INT NOT NULL CHECK (target_hour BETWEEN 0 AND 23),
    open_at                 TIMESTAMPTZ NOT NULL,
    close_at                TIMESTAMPTZ,
    polymarket_probability  FLOAT CHECK (polymarket_probability BETWEEN 0 AND 1),
    status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'settled')),
    btc_target_low_price    FLOAT,
    btc_target_high_price   FLOAT,
    btc_target_price        FLOAT,
    btc_actual_low_price    FLOAT,
    btc_actual_high_price   FLOAT,
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
    telegram_group_chat_id TEXT,
    telegram_group_name TEXT,
    predicted_low_price FLOAT NOT NULL CHECK (predicted_low_price > 0),
    predicted_high_price FLOAT NOT NULL CHECK (predicted_high_price >= predicted_low_price),
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
-- Lightning invoices linked to predictions
-- ============================================================
CREATE TABLE IF NOT EXISTS lightning_invoices (
    id              BIGSERIAL PRIMARY KEY,
    prediction_id   BIGINT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
    payment_hash    BYTEA NOT NULL UNIQUE,
    invoice         TEXT NOT NULL,
    memo            TEXT,
    amount_sats     INT NOT NULL CHECK (amount_sats > 0),
    paid            BOOL NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lightning_invoices_prediction_id
    ON lightning_invoices(prediction_id);
CREATE INDEX IF NOT EXISTS idx_lightning_invoices_paid
    ON lightning_invoices(paid);

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
    exchange_platform TEXT NOT NULL DEFAULT 'binance',
    exchange_order_id TEXT,
    exchange_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
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
    ('prediction_target_hour', '19'),
    ('prediction_open_hour', '8'),
    ('prediction_window_hours', '11'),
    ('min_sats', '1000'),
    ('max_sats', '10000'),
    ('weekly_vote_day', '6'),
    ('weekly_vote_hour', '20'),
    ('report_hours_before_target', '8'),
    ('pm_conf_weight_min_pct', '10'),
    ('pm_conf_weight_max_pct', '30'),
    ('pm_trade_window_minutes', '60'),
    ('pm_market_max_distance_pct', '5'),
    ('exchange_platform', 'hyperliquid'),
    ('hyperliquid_enabled', 'false'),
    ('hyperliquid_max_slippage_bps', '75'),
    ('hyperliquid_perp_leverage_cap', '5'),
    ('hyperliquid_bootstrap_ready', 'false'),
    ('hyperliquid_bootstrap_state', 'disabled'),
    ('trading_enabled', 'true'),
    ('bot_desired_state', 'running'),
    ('bot_actual_state', 'offline'),
    ('bot_restart_token', ''),
    ('bot_heartbeat_at', '')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Strategy votes (weekly)
-- ============================================================
CREATE TABLE IF NOT EXISTS strategy_votes (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start  DATE NOT NULL,
    strategy    CHAR(1) NOT NULL CHECK (strategy IN ('A', 'B', 'C', 'D', 'E')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_strategy_votes_week ON strategy_votes(week_start);

-- ============================================================
-- Legacy constraint cleanup
-- ============================================================
-- Drop the old one-round-per-day unique constraint if it exists,
-- allowing manual override rounds on the same question_date.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'trades' AND column_name = 'binance_order_id'
  ) THEN
    ALTER TABLE trades RENAME COLUMN binance_order_id TO exchange_order_id;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE trades
    ADD COLUMN IF NOT EXISTS exchange_platform TEXT NOT NULL DEFAULT 'binance',
    ADD COLUMN IF NOT EXISTS exchange_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
END $$;

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

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_predictions_round_id ON predictions(round_id);
CREATE INDEX IF NOT EXISTS idx_predictions_user_id ON predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_predictions_paid ON predictions(paid);
CREATE INDEX IF NOT EXISTS idx_predictions_telegram_group_chat_id ON predictions(telegram_group_chat_id);
CREATE INDEX IF NOT EXISTS idx_predictions_telegram_group_name ON predictions(telegram_group_name);
CREATE INDEX IF NOT EXISTS idx_prediction_rounds_question_date ON prediction_rounds(question_date);
CREATE INDEX IF NOT EXISTS idx_polymarket_bitcoiners_snapshot_date
    ON polymarket_bitcoiners(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_polymarket_bitcoiners_market_condition_id
    ON polymarket_bitcoiners(market_condition_id);
CREATE INDEX IF NOT EXISTS idx_polymarket_bitcoiners_proxy_wallet
    ON polymarket_bitcoiners(proxy_wallet);
CREATE INDEX IF NOT EXISTS idx_trades_round_id ON trades(round_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_balance_entries_user_id ON balance_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_users_platform_identity ON users(platform, platform_user_id);
