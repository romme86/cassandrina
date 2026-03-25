"""
Postgres persistence layer for Cassandrina.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
import os
from typing import Iterator

from psycopg2.pool import SimpleConnectionPool
from psycopg2.extras import RealDictCursor


class PostgresRepository:
    def __init__(self, database_url: str | None = None):
        dsn = database_url or os.environ["DATABASE_URL"]
        self._pool = SimpleConnectionPool(1, 5, dsn=dsn)

    @contextmanager
    def _cursor(self, commit: bool = False) -> Iterator[RealDictCursor]:
        conn = self._pool.getconn()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                yield cur
            if commit:
                conn.commit()
            else:
                conn.rollback()
        except Exception:
            conn.rollback()
            raise
        finally:
            self._pool.putconn(conn)

    def get_bot_config(self) -> dict[str, str]:
        with self._cursor() as cur:
            cur.execute("SELECT key, value FROM bot_config")
            return {row["key"]: row["value"] for row in cur.fetchall()}

    def create_round(
        self,
        *,
        date: date,
        target_hour: int,
        open_at: datetime | None = None,
        close_at: datetime | None = None,
    ) -> dict:
        open_at = open_at or datetime.now(timezone.utc)
        close_at = close_at or (open_at + timedelta(hours=6))
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                INSERT INTO prediction_rounds (question_date, target_hour, open_at, close_at, status)
                VALUES (%s, %s, %s, %s, 'open')
                RETURNING *
                """,
                (date, target_hour, open_at, close_at),
            )
            return dict(cur.fetchone())

    def get_open_round(self) -> dict | None:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM prediction_rounds
                WHERE status = 'open'
                ORDER BY open_at DESC, id DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
            return dict(row) if row else None

    def get_rounds_for_settlement(self, target_date: date | None = None) -> list[dict]:
        target_date = target_date or datetime.now(timezone.utc).date()
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM prediction_rounds
                WHERE question_date = %s AND status IN ('open', 'closed')
                ORDER BY open_at ASC, id ASC
                """,
                (target_date,),
            )
            return [dict(row) for row in cur.fetchall()]

    def close_round(self, round_id: int) -> None:
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                UPDATE prediction_rounds
                SET status = 'closed', close_at = COALESCE(close_at, NOW())
                WHERE id = %s
                """,
                (round_id,),
            )

    def settle_round(self, round_id: int, actual_price: float) -> None:
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                UPDATE prediction_rounds
                SET status = 'settled', btc_actual_price = %s
                WHERE id = %s
                """,
                (actual_price, round_id),
            )

    def update_round_analysis(
        self,
        round_id: int,
        *,
        polymarket_probability: float,
        btc_target_price: float,
        confidence_score: float,
        strategy_used: str,
    ) -> None:
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                UPDATE prediction_rounds
                SET polymarket_probability = %s,
                    btc_target_price = %s,
                    confidence_score = %s,
                    strategy_used = %s
                WHERE id = %s
                """,
                (
                    polymarket_probability,
                    btc_target_price,
                    confidence_score,
                    strategy_used,
                    round_id,
                ),
            )

    def get_paid_predictions_count(self, round_id: int) -> int:
        with self._cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS count FROM predictions WHERE round_id = %s AND paid = TRUE",
                (round_id,),
            )
            return int(cur.fetchone()["count"])

    def get_round_total_paid_sats(self, round_id: int) -> int:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(SUM(sats_amount), 0) AS total
                FROM predictions
                WHERE round_id = %s AND paid = TRUE
                """,
                (round_id,),
            )
            return int(cur.fetchone()["total"])

    def get_round_participant_count(self, round_id: int) -> int:
        with self._cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS count FROM predictions WHERE round_id = %s",
                (round_id,),
            )
            return int(cur.fetchone()["count"])

    def get_unpaid_invoices(self, round_id: int) -> list[dict]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT li.id,
                       encode(li.payment_hash, 'hex') AS payment_hash,
                       li.amount_sats,
                       li.created_at,
                       li.expires_at,
                       p.id AS prediction_id
                FROM lightning_invoices li
                JOIN predictions p ON p.id = li.prediction_id
                WHERE p.round_id = %s
                  AND li.paid = FALSE
                ORDER BY li.created_at ASC
                """,
                (round_id,),
            )
            return [dict(row) for row in cur.fetchall()]

    def mark_invoice_paid(self, invoice_id: int, paid_at: datetime | None = None) -> None:
        paid_at = paid_at or datetime.now(timezone.utc)
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                UPDATE lightning_invoices
                SET paid = TRUE, paid_at = %s
                WHERE id = %s AND paid = FALSE
                RETURNING prediction_id, amount_sats
                """,
                (paid_at, invoice_id),
            )
            row = cur.fetchone()
            if row:
                cur.execute(
                    """
                    UPDATE predictions
                    SET paid = TRUE, paid_at = %s
                    WHERE id = %s
                    """,
                    (paid_at, row["prediction_id"]),
                )
                cur.execute(
                    """
                    INSERT INTO balance_entries (user_id, round_id, delta_sats, reason)
                    SELECT p.user_id, p.round_id, %s, 'invoice_paid'
                    FROM predictions p
                    WHERE p.id = %s
                    """,
                    (int(row["amount_sats"]), row["prediction_id"]),
                )

    def get_paid_predictions(self, round_id: int) -> list[dict]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT p.id,
                       p.user_id,
                       p.predicted_price,
                       p.sats_amount,
                       p.created_at,
                       u.display_name,
                       u.accuracy,
                       u.congruency
                FROM predictions p
                JOIN users u ON u.id = p.user_id
                WHERE p.round_id = %s AND p.paid = TRUE
                ORDER BY p.sats_amount DESC, p.created_at ASC
                """,
                (round_id,),
            )
            return [dict(row) for row in cur.fetchall()]

    def update_user_scores(self, user_id: int, accuracy: float, congruency: float) -> None:
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                UPDATE users
                SET accuracy = %s, congruency = %s
                WHERE id = %s
                """,
                (accuracy, congruency, user_id),
            )

    def create_trade(
        self,
        *,
        round_id: int,
        strategy: str,
        direction: str,
        entry_price: float,
        target_price: float,
        leverage: int,
        sats_deployed: int,
        binance_order_id: str | None = None,
    ) -> dict:
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                INSERT INTO trades
                    (round_id, strategy, direction, entry_price, target_price, leverage, sats_deployed, binance_order_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    round_id,
                    strategy,
                    direction,
                    entry_price,
                    target_price,
                    leverage,
                    sats_deployed,
                    binance_order_id,
                ),
            )
            return dict(cur.fetchone())

    def get_open_trade_for_round(self, round_id: int) -> dict | None:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM trades
                WHERE round_id = %s AND status = 'open'
                ORDER BY opened_at DESC
                LIMIT 1
                """,
                (round_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None

    def close_trade(self, trade_id: int, *, status: str, pnl_sats: int, closed_at: datetime | None = None) -> None:
        closed_at = closed_at or datetime.now(timezone.utc)
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                UPDATE trades
                SET status = %s,
                    pnl_sats = %s,
                    closed_at = %s
                WHERE id = %s
                """,
                (status, pnl_sats, closed_at, trade_id),
            )

    def add_balance_entries(self, entries: list[dict]) -> None:
        if not entries:
            return
        with self._cursor(commit=True) as cur:
            for entry in entries:
                cur.execute(
                    """
                    INSERT INTO balance_entries (user_id, round_id, delta_sats, reason)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        entry["user_id"],
                        entry.get("round_id"),
                        entry["delta_sats"],
                        entry["reason"],
                    ),
                )
