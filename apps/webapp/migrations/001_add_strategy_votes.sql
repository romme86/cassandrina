-- Up Migration: Add strategy_votes table

CREATE TABLE IF NOT EXISTS strategy_votes (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start  DATE NOT NULL,
    strategy    CHAR(1) NOT NULL CHECK (strategy IN ('A', 'B', 'C', 'D', 'E')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_strategy_votes_week ON strategy_votes(week_start);
