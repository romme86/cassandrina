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
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

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
    ):
        self.config = config
        self._redis = redis_client
        self._db = db
        # Hook: called with round_id when prediction window closes and trade should execute
        self.on_trade_execute = None

    # ── Public API ────────────────────────────────────────────

    def open_prediction_window(self) -> dict:
        """Create today's round and notify the WhatsApp bot."""
        now = datetime.now(timezone.utc)
        round_data = self._db.create_round(
            date=now.date(),
            target_hour=self.config.prediction_target_hour,
        )
        round_id = round_data["id"]
        self._publish(
            "prediction:open",
            {"round_id": round_id, "target_hour": self.config.prediction_target_hour},
        )
        return round_data

    def try_close_window(self, round_id: int) -> bool:
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
        self._publish("prediction:close", {"round_id": round_id, "paid_count": paid_count})

        if callable(self.on_trade_execute):
            self.on_trade_execute(round_id=round_id)

        return True

    def send_8h_report(self, round_id: int) -> None:
        """Publish the 8-hour portfolio stats event."""
        self._publish(
            "stats:8h",
            {"round_id": round_id, "hours_to_target": self.config.report_hours_before_target},
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
        # In production this would query the DB for the current open round
        pass

    def _job_8h_report(self) -> None:
        # In production this would query the DB for the current round
        pass

    # ── Redis helper ──────────────────────────────────────────

    def _publish(self, event: str, payload: dict) -> None:
        channel = f"{_CHANNEL_PREFIX}{event}"
        message = json.dumps(payload)
        self._redis.publish(channel, message)
        logger.debug("Published %s: %s", channel, message)
