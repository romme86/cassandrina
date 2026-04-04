"""
Postgres persistence layer for Cassandrina.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
import os
import threading
from typing import Iterator

from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor


class PostgresRepository:
    def __init__(self, database_url: str | None = None):
        dsn = database_url or os.environ["DATABASE_URL"]
        self._pool = ThreadedConnectionPool(1, 5, dsn=dsn)
        self._local = threading.local()

    def close(self) -> None:
        """Close all connections in the pool."""
        self._pool.closeall()

    @contextmanager
    def connection(self) -> Iterator[None]:
        """Acquire a single connection shared by all methods called within.

        Commits on clean exit, rolls back on exception. Nested calls are
        no-ops — only the outermost ``connection()`` manages the lifecycle.
        """
        existing = getattr(self._local, "conn", None)
        if existing is not None:
            yield
            return
        conn = self._pool.getconn()
        self._local.conn = conn
        try:
            yield
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            self._local.conn = None
            self._pool.putconn(conn)

    @contextmanager
    def _cursor(self, commit: bool = False) -> Iterator[RealDictCursor]:
        shared = getattr(self._local, "conn", None)
        if shared is not None:
            with shared.cursor(cursor_factory=RealDictCursor) as cur:
                yield cur
            # commit/rollback handled by the connection() manager
            return
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

    def set_bot_config_values(self, values: dict[str, str]) -> None:
        if not values:
            return
        with self._cursor(commit=True) as cur:
            for key, value in values.items():
                cur.execute(
                    """
                    INSERT INTO bot_config (key, value, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (key)
                    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                    """,
                    (key, value),
                )

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
                RETURNING id, question_date, target_hour, open_at, close_at, status
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

    def settle_round_with_extremes(
        self,
        round_id: int,
        *,
        actual_price: float,
        actual_low_price: float,
        actual_high_price: float,
    ) -> None:
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                UPDATE prediction_rounds
                SET status = 'settled',
                    btc_actual_price = %s,
                    btc_actual_low_price = %s,
                    btc_actual_high_price = %s
                WHERE id = %s
                """,
                (actual_price, actual_low_price, actual_high_price, round_id),
            )

    def update_round_analysis(
        self,
        round_id: int,
        *,
        btc_target_low_price: float,
        btc_target_high_price: float,
        polymarket_probability: float,
        btc_target_price: float,
        confidence_score: float,
        strategy_used: str,
    ) -> None:
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                UPDATE prediction_rounds
                SET btc_target_low_price = %s,
                    btc_target_high_price = %s,
                    polymarket_probability = %s,
                    btc_target_price = %s,
                    confidence_score = %s,
                    strategy_used = %s
                WHERE id = %s
                """,
                (
                    btc_target_low_price,
                    btc_target_high_price,
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

    def mark_invoice_paid(self, invoice_id: int, paid_at: datetime | None = None) -> dict | None:
        paid_at = paid_at or datetime.now(timezone.utc)
        with self._cursor(commit=True) as cur:
            # Advisory lock prevents concurrent mark_invoice_paid for the same invoice
            cur.execute("SELECT pg_advisory_xact_lock(2147483647, %s)", (invoice_id,))
            cur.execute(
                """
                UPDATE lightning_invoices
                SET paid = TRUE, paid_at = %s
                WHERE id = %s AND paid = FALSE
                RETURNING prediction_id, amount_sats, paid_at
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
                cur.execute(
                    """
                    SELECT li.id,
                           li.amount_sats,
                           li.paid_at,
                           p.id AS prediction_id,
                           p.round_id,
                           p.telegram_group_chat_id,
                           p.telegram_group_name,
                           u.platform,
                           u.platform_user_id,
                           u.display_name
                    FROM lightning_invoices li
                    JOIN predictions p ON p.id = li.prediction_id
                    JOIN users u ON u.id = p.user_id
                    WHERE li.id = %s
                    """,
                    (invoice_id,),
                )
                return dict(cur.fetchone())
        return None

    def get_paid_predictions(self, round_id: int) -> list[dict]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT p.id,
                       p.user_id,
                       p.predicted_low_price,
                       p.predicted_high_price,
                       p.predicted_price,
                       p.sats_amount,
                       p.created_at,
                       u.display_name,
                       u.platform,
                       u.platform_user_id,
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

    def get_user_settled_prediction_history(self, user_id: int) -> list[dict]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT p.predicted_low_price,
                       p.predicted_high_price,
                       p.sats_amount,
                       r.btc_actual_low_price,
                       r.btc_actual_high_price
                FROM predictions p
                JOIN prediction_rounds r ON r.id = p.round_id
                WHERE p.user_id = %s
                  AND p.paid = TRUE
                  AND r.status = 'settled'
                  AND r.btc_actual_low_price IS NOT NULL
                  AND r.btc_actual_high_price IS NOT NULL
                ORDER BY p.created_at ASC, p.id ASC
                """,
                (user_id,),
            )
            return [dict(row) for row in cur.fetchall()]

    def get_user_balances(self, user_ids: list[int]) -> dict[int, int]:
        if not user_ids:
            return {}
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT user_id, COALESCE(SUM(delta_sats), 0)::int AS balance_sats
                FROM balance_entries
                WHERE user_id = ANY(%s)
                GROUP BY user_id
                """,
                (user_ids,),
            )
            return {int(row["user_id"]): int(row["balance_sats"]) for row in cur.fetchall()}

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
                RETURNING id, round_id, strategy, direction, entry_price, target_price, leverage, sats_deployed, status, binance_order_id, opened_at
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

    def record_strategy_vote(self, user_id: int, week_start: date, strategy: str) -> None:
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                INSERT INTO strategy_votes (user_id, week_start, strategy)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, week_start) DO UPDATE SET strategy = EXCLUDED.strategy
                """,
                (user_id, week_start, strategy),
            )

    def get_weekly_vote_results(self, week_start: date) -> dict[str, int]:
        """Returns {strategy: vote_count} for the given week."""
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT strategy, COUNT(*)::int AS votes
                FROM strategy_votes
                WHERE week_start = %s
                GROUP BY strategy
                ORDER BY votes DESC
                """,
                (week_start,),
            )
            return {row["strategy"]: row["votes"] for row in cur.fetchall()}

    def get_winning_vote_strategy(self, week_start: date) -> str | None:
        """Returns the most-voted strategy for the week, or None if no votes."""
        results = self.get_weekly_vote_results(week_start)
        if not results:
            return None
        return max(results, key=results.get)

    def get_total_user_balances(self) -> int:
        """Sum of all balance entries across all users (net sats in the system)."""
        with self._cursor() as cur:
            cur.execute("SELECT COALESCE(SUM(delta_sats), 0) AS total FROM balance_entries")
            return int(cur.fetchone()["total"])

    def get_total_deposited_sats(self) -> int:
        """Sum of all paid prediction amounts (total sats deposited via Lightning)."""
        with self._cursor() as cur:
            cur.execute(
                "SELECT COALESCE(SUM(sats_amount), 0) AS total FROM predictions WHERE paid = TRUE"
            )
            return int(cur.fetchone()["total"])

    def cleanup_expired_invoices(self) -> int:
        """Delete expired unpaid invoices and their associated unpaid predictions.

        Returns the number of cleaned-up predictions.
        """
        with self._cursor(commit=True) as cur:
            cur.execute(
                """
                DELETE FROM lightning_invoices
                WHERE paid = FALSE AND expires_at < NOW()
                RETURNING prediction_id
                """
            )
            expired_rows = cur.fetchall()
            if not expired_rows:
                return 0
            prediction_ids = [row["prediction_id"] for row in expired_rows]
            cur.execute(
                """
                DELETE FROM predictions
                WHERE id = ANY(%s) AND paid = FALSE
                """,
                (prediction_ids,),
            )
            return len(prediction_ids)

    def add_balance_entries(self, entries: list[dict]) -> None:
        if not entries:
            return
        with self._cursor(commit=True) as cur:
            values = []
            params: list = []
            for entry in entries:
                values.append("(%s, %s, %s, %s)")
                params.extend([
                    entry["user_id"],
                    entry.get("round_id"),
                    entry["delta_sats"],
                    entry["reason"],
                ])
            cur.execute(
                f"""
                INSERT INTO balance_entries (user_id, round_id, delta_sats, reason)
                VALUES {', '.join(values)}
                """,
                params,
            )
