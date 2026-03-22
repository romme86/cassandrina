"""
Prediction Scheduler for Cassandrina.

Manages the daily prediction cycle:
  08:00 UTC — open prediction window (configurable)
  08:00–14:00 — collect predictions (6h window, configurable)
  14:00 — close window (early if all users paid)
  08:00 — 8h report (8h before 16:00 target)
  16:00 — evaluate predictions, update scores, trigger trade
  Sunday 20:00 UTC — weekly vote

Uses APScheduler for job scheduling and Redis pub/sub for outbound events.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum

from cassandrina.profit import distribute_profit
from cassandrina.scoring import (
    compute_confidence,
    compute_congruency,
    is_prediction_correct,
    update_accuracy,
    update_congruency,
)
from cassandrina.strategy import get_direction, get_leverage, select_strategy

logger = logging.getLogger(__name__)

_CHANNEL_PREFIX = "cassandrina:"


class RoundStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"
    SETTLED = "settled"


@dataclass
class SchedulerConfig:
    prediction_open_hour: int = 8
    prediction_target_hour: int = 16
    prediction_window_hours: int = 6
    weekly_vote_day: int = 6        # 0=Monday … 6=Sunday
    weekly_vote_hour: int = 20
    report_hours_before_target: int = 8
    min_paid_predictions: int = 1


class PredictionScheduler:
    """
    Coordinates the prediction lifecycle.

    *db* must expose:
        create_round(date, target_hour) → dict with 'id'
        close_round(round_id)
        get_paid_predictions_count(round_id) → int
        get_round_status(round_id) → RoundStatus

    *redis_client* must expose:
        publish(channel, message)
    """

    def __init__(
        self,
        config: SchedulerConfig,
        redis_client,
        db,
        lnd_client=None,
        trade_executor=None,
        polymarket_client=None,
        market_data_client=None,
    ):
        self.config = config
        self._redis = redis_client
        self._db = db
        self._lnd = lnd_client
        self._trade_executor = trade_executor
        self._polymarket = polymarket_client
        self._market_data = market_data_client
        # Hook: called with round_id when prediction window closes and trade should execute
        self.on_trade_execute = None

    # ── Public API ────────────────────────────────────────────

    def open_prediction_window(self) -> dict:
        """Create today's round and notify the messaging bot."""
        now = datetime.now(timezone.utc)
        bot_config = self._safe_get_bot_config()
        close_at = now + timedelta(hours=self.config.prediction_window_hours)
        round_data = self._db.create_round(
            date=now.date(),
            target_hour=self.config.prediction_target_hour,
            open_at=now,
            close_at=close_at,
        )
        round_id = round_data["id"]
        self._publish(
            "prediction:open",
            {
                "round_id": round_id,
                "target_hour": self.config.prediction_target_hour,
                "min_sats": int(bot_config.get("min_sats", 100)),
                "max_sats": int(bot_config.get("max_sats", 5000)),
                "close_at": close_at.isoformat(),
            },
        )
        return round_data

    def try_close_window(self, round_id: int, close_reason: str = "paid_threshold") -> bool:
        """
        Attempt to close the prediction window.

        Closes if at least *min_paid_predictions* are paid.
        After closing, publishes a prediction:close event and invokes
        on_trade_execute (if set).
        Returns True if the window was closed.
        """
        paid_count = self._db.get_paid_predictions_count(round_id)
        if paid_count < self.config.min_paid_predictions:
            return False

        self._db.close_round(round_id)
        total_sats = self._db.get_round_total_paid_sats(round_id)
        self._publish(
            "prediction:close",
            {
                "round_id": round_id,
                "paid_count": paid_count,
                "total_sats": total_sats,
                "close_reason": close_reason,
            },
        )
        self._execute_trade_for_round(round_id)

        if callable(self.on_trade_execute):
            self.on_trade_execute(round_id=round_id)

        return True

    def send_8h_report(self, round_id: int) -> None:
        """Publish the 8-hour portfolio stats event."""
        participant_count = self._db.get_round_participant_count(round_id)
        paid_count = self._db.get_paid_predictions_count(round_id)
        total_sats = self._db.get_round_total_paid_sats(round_id)
        self._publish(
            "stats:8h",
            {
                "round_id": round_id,
                "hours_to_target": self.config.report_hours_before_target,
                "participant_count": participant_count,
                "paid_count": paid_count,
                "total_sats": total_sats,
            },
        )

    def send_weekly_vote(self) -> None:
        """Publish the weekly strategy vote event."""
        self._publish(
            "weekly:vote",
            {
                "options": ["A (Aggressive)", "B (Moderate)", "C (Grid)", "D (Safe)", "E (Conservative)"],
                "closes_in_hours": 24,
            },
        )

    # ── APScheduler setup ─────────────────────────────────────

    def start(self) -> None:
        """Register APScheduler jobs and start the scheduler."""
        from apscheduler.schedulers.background import BackgroundScheduler

        self._scheduler = BackgroundScheduler(timezone="UTC")

        # Open prediction window daily
        self._scheduler.add_job(
            self._job_open_window,
            "cron",
            hour=self.config.prediction_open_hour,
            minute=0,
        )

        # 8h report daily
        report_hour = self.config.prediction_target_hour - self.config.report_hours_before_target
        self._scheduler.add_job(
            self._job_8h_report,
            "cron",
            hour=report_hour % 24,
            minute=0,
        )

        # Try-close check every 10 minutes
        self._scheduler.add_job(
            self._job_try_close,
            "interval",
            minutes=10,
        )

        self._scheduler.add_job(
            self._job_settle_round,
            "cron",
            hour=self.config.prediction_target_hour,
            minute=0,
        )

        # Weekly vote
        self._scheduler.add_job(
            self.send_weekly_vote,
            "cron",
            day_of_week=self.config.weekly_vote_day,
            hour=self.config.weekly_vote_hour,
            minute=0,
        )

        self._scheduler.start()
        logger.info("Cassandrina scheduler started")

    def stop(self) -> None:
        if hasattr(self, "_scheduler"):
            self._scheduler.shutdown()

    # ── Internal jobs ─────────────────────────────────────────

    def _job_open_window(self) -> None:
        try:
            self.open_prediction_window()
        except Exception:
            logger.exception("Failed to open prediction window")

    def _job_try_close(self) -> None:
        round_data = self._db.get_open_round()
        if not round_data:
            return

        self._verify_round_payments(round_data["id"])

        paid_count = self._db.get_paid_predictions_count(round_data["id"])
        now = datetime.now(timezone.utc)
        close_at = round_data.get("close_at")

        if paid_count >= self.config.min_paid_predictions:
            self.try_close_window(round_data["id"], close_reason="paid_threshold")
            return

        if close_at and now >= close_at:
            if paid_count > 0:
                self.try_close_window(round_data["id"], close_reason="window_expired")
            else:
                self._db.close_round(round_data["id"])
                self._publish(
                    "prediction:close",
                    {
                        "round_id": round_data["id"],
                        "paid_count": 0,
                        "total_sats": 0,
                        "close_reason": "window_expired",
                    },
                )

    def _job_8h_report(self) -> None:
        round_data = self._db.get_open_round()
        if round_data:
            self.send_8h_report(round_data["id"])

    def _job_settle_round(self) -> None:
        round_data = self._db.get_round_for_settlement()
        if not round_data or not self._market_data:
            return

        if round_data["status"] == "open":
            self._verify_round_payments(round_data["id"])
            if self._db.get_paid_predictions_count(round_data["id"]) > 0:
                self.try_close_window(round_data["id"], close_reason="target_time")
            else:
                self._db.close_round(round_data["id"])

        actual_price = self._market_data.get_btc_price()
        self._db.settle_round(round_data["id"], actual_price)

        bot_config = self._safe_get_bot_config()
        max_sats = int(bot_config.get("max_sats", 5000))
        participants = self._db.get_paid_predictions(round_data["id"])
        for participant in participants:
            correct = is_prediction_correct(participant["predicted_price"], actual_price)
            round_congruency = compute_congruency(participant["sats_amount"], max_sats)
            accuracy = update_accuracy(float(participant["accuracy"]), correct)
            congruency = update_congruency(float(participant["congruency"]), round_congruency)
            self._db.update_user_scores(participant["user_id"], accuracy, congruency)

        trade = self._db.get_open_trade_for_round(round_data["id"])
        if not trade:
            return

        pnl_sats, status = self._compute_trade_outcome(trade, actual_price)
        self._db.close_trade(trade["id"], status=status, pnl_sats=pnl_sats)
        distributions = distribute_profit(
            pnl_sats,
            [
                {"user_id": p["user_id"], "sats_invested": p["sats_amount"]}
                for p in participants
            ],
        )
        self._db.add_balance_entries(
            [
                {
                    "user_id": user_id,
                    "round_id": round_data["id"],
                    "delta_sats": delta_sats,
                    "reason": f"trade_{status}",
                }
                for user_id, delta_sats in distributions.items()
            ]
        )
        self._publish(
            f"trade:{status}",
            {
                "round_id": round_data["id"],
                "trade_id": trade["id"],
                "status": status,
                "pnl_sats": pnl_sats,
            },
        )

    # ── Redis helper ──────────────────────────────────────────

    def _publish(self, event: str, payload: dict) -> None:
        channel = f"{_CHANNEL_PREFIX}{event}"
        message = json.dumps(payload)
        self._redis.publish(channel, message)
        logger.debug("Published %s: %s", channel, message)

    def _safe_get_bot_config(self) -> dict[str, str]:
        try:
            return self._db.get_bot_config()
        except Exception:
            logger.exception("Failed to load bot config")
            return {}

    def _verify_round_payments(self, round_id: int) -> None:
        if not self._lnd:
            return
        try:
            invoices = self._db.get_unpaid_invoices(round_id)
        except Exception:
            logger.exception("Failed to load unpaid invoices")
            return
        for invoice in invoices:
            try:
                result = self._lnd.verify_payment(invoice["payment_hash"])
            except Exception:
                logger.exception("Failed to verify invoice %s", invoice["id"])
                continue
            if result.get("settled"):
                self._db.mark_invoice_paid(invoice["id"])

    def _execute_trade_for_round(self, round_id: int) -> None:
        existing_trade = self._db.get_open_trade_for_round(round_id)
        if existing_trade:
            return

        participants = self._db.get_paid_predictions(round_id)
        if not participants or not self._market_data:
            return

        bot_config = self._safe_get_bot_config()
        max_sats = int(bot_config.get("max_sats", 5000))
        trading_enabled = bot_config.get("trading_enabled", "false").lower() == "true"
        target_price = self._compute_target_price(participants)
        polymarket_probability = 0.5
        if self._polymarket:
            try:
                polymarket_probability = self._polymarket.fetch_btc_probability(
                    datetime.now(timezone.utc).date()
                )
            except Exception:
                logger.exception("Failed to fetch Polymarket probability")
        avg_accuracy = sum(float(p["accuracy"]) for p in participants) / len(participants)
        avg_congruency = sum(
            compute_congruency(int(p["sats_amount"]), max_sats) for p in participants
        ) / len(participants)
        confidence_score = compute_confidence(
            avg_accuracy=avg_accuracy,
            avg_congruency=avg_congruency,
            polymarket_probability=polymarket_probability,
        )
        strategy = select_strategy(confidence_score)
        current_price = self._market_data.get_btc_price()
        direction = get_direction(current_price, target_price)
        sats_deployed = sum(int(p["sats_amount"]) for p in participants)
        self._db.update_round_analysis(
            round_id,
            polymarket_probability=polymarket_probability,
            btc_target_price=target_price,
            confidence_score=confidence_score,
            strategy_used=strategy.value,
        )

        result = {"type": "dry_run", "order": {"orderId": f"dry-run-{round_id}"}}
        if trading_enabled and self._trade_executor:
            result = self._trade_executor.execute(
                strategy=strategy,
                direction=direction,
                current_price=current_price,
                target_price=target_price,
                sats_deployed=sats_deployed,
            )

        order_payload = result.get("order")
        order_id = None
        if isinstance(order_payload, dict):
            order_id = order_payload.get("orderId")
        trade = self._db.create_trade(
            round_id=round_id,
            strategy=strategy.value,
            direction=direction,
            entry_price=current_price,
            target_price=target_price,
            leverage=get_leverage(strategy),
            sats_deployed=sats_deployed,
            binance_order_id=str(order_id) if order_id is not None else None,
        )
        self._publish(
            "trade:opened",
            {
                "round_id": round_id,
                "trade_id": trade["id"],
                "strategy": strategy.value,
                "direction": direction,
                "entry_price": current_price,
                "target_price": target_price,
                "sats_deployed": sats_deployed,
                "dry_run": not trading_enabled,
            },
        )

    @staticmethod
    def _compute_target_price(participants: list[dict]) -> float:
        total_sats = sum(int(p["sats_amount"]) for p in participants)
        if total_sats <= 0:
            return float(participants[0]["predicted_price"])
        weighted_total = sum(
            float(p["predicted_price"]) * int(p["sats_amount"]) for p in participants
        )
        return weighted_total / total_sats

    @staticmethod
    def _compute_trade_outcome(trade: dict, actual_price: float) -> tuple[int, str]:
        entry_price = float(trade["entry_price"])
        direction = trade["direction"]
        leverage = max(int(trade["leverage"]), 1)
        sats_deployed = int(trade["sats_deployed"])
        price_change = (actual_price - entry_price) / entry_price if entry_price else 0.0
        directional_move = price_change if direction == "long" else -price_change
        if leverage > 1 and directional_move <= -(1 / leverage):
            return -sats_deployed, "liquidated"
        pnl_sats = int(round(sats_deployed * directional_move * leverage))
        return pnl_sats, "closed"
