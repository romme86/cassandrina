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

CREATE INDEX IF NOT EXISTS idx_polymarket_bitcoiners_snapshot_date
    ON polymarket_bitcoiners(snapshot_date);

CREATE INDEX IF NOT EXISTS idx_polymarket_bitcoiners_market_condition_id
    ON polymarket_bitcoiners(market_condition_id);

CREATE INDEX IF NOT EXISTS idx_polymarket_bitcoiners_proxy_wallet
    ON polymarket_bitcoiners(proxy_wallet);
