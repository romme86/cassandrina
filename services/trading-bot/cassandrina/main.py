"""
Cassandrina Trading Bot — Entry Point.

Starts the scheduler, connects to Redis, and runs the prediction
lifecycle until interrupted.
"""

import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone

import redis
from dotenv import load_dotenv

from cassandrina.binance_client import BinanceClientWrapper
from cassandrina.lnd_client import LNDClient
from cassandrina.market_data import MarketDataClient
from cassandrina.polymarket import PolymarketClient
from cassandrina.repository import PostgresRepository
from cassandrina.scheduler import PredictionScheduler, SchedulerConfig
from cassandrina.trade_executor import TradeExecutor

import json as _json_mod

class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info and record.exc_info[1]:
            entry["error"] = str(record.exc_info[1])
            entry["traceback"] = self.formatException(record.exc_info)
        return _json_mod.dumps(entry)

_handler = logging.StreamHandler()
_handler.setFormatter(_JsonFormatter())
logging.basicConfig(
    level=logging.INFO,
    handlers=[_handler],
)
logger = logging.getLogger(__name__)

CONTROL_POLL_INTERVAL_SECONDS = 5
HEARTBEAT_INTERVAL_SECONDS = 15
BOT_STATE_VALUES = {"running", "paused", "stopped"}


def _normalize_bot_state(value: str | None, fallback: str = "running") -> str:
    if value in BOT_STATE_VALUES:
        return value
    return fallback


def main() -> None:
    load_dotenv()
    redis_url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    redis_client = redis.from_url(redis_url, decode_responses=True)
    db = PostgresRepository(os.environ.get("DATABASE_URL"))

    config = SchedulerConfig(
        scheduler_timezone=os.environ.get("SCHEDULER_TIMEZONE", "UTC"),
        prediction_open_hour=int(os.environ.get("PREDICTION_OPEN_HOUR", 8)),
        prediction_target_hour=int(os.environ.get("PREDICTION_TARGET_HOUR", 16)),
        prediction_window_hours=int(os.environ.get("PREDICTION_WINDOW_HOURS", 6)),
        weekly_vote_day=int(os.environ.get("WEEKLY_VOTE_DAY", 6)),
        weekly_vote_hour=int(os.environ.get("WEEKLY_VOTE_HOUR", 20)),
        report_hours_before_target=int(os.environ.get("REPORT_HOURS_BEFORE_TARGET", 8)),
        min_paid_predictions=1,
    )
    market_data = MarketDataClient()
    polymarket = PolymarketClient(api_key=os.environ.get("POLYMARKET_API_KEY"))
    lnd_client = None
    if os.environ.get("LND_HOST") and os.environ.get("LND_MACAROON_HEX"):
        lnd_client = LNDClient()

    trade_executor = None
    if os.environ.get("BINANCE_API_KEY") and os.environ.get("BINANCE_API_SECRET"):
        trade_executor = TradeExecutor(BinanceClientWrapper())

    scheduler = PredictionScheduler(
        config=config,
        redis_client=redis_client,
        db=db,
        lnd_client=lnd_client,
        trade_executor=trade_executor,
        polymarket_client=polymarket,
        market_data_client=market_data,
    )

    scheduler_running = False
    last_restart_token = ""
    last_actual_state = "offline"
    last_heartbeat_write = 0.0

    def update_runtime_state(actual_state: str, *, force: bool = False) -> None:
        nonlocal last_actual_state, last_heartbeat_write
        now = time.monotonic()
        state_changed = actual_state != last_actual_state
        if not force and not state_changed and now - last_heartbeat_write < HEARTBEAT_INTERVAL_SECONDS:
            return
        db.set_bot_config_values(
            {
                "bot_actual_state": actual_state,
                "bot_heartbeat_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        last_actual_state = actual_state
        last_heartbeat_write = now

    def reconcile_scheduler_state() -> None:
        nonlocal scheduler_running, last_restart_token
        bot_config = db.get_bot_config()
        desired_state = _normalize_bot_state(bot_config.get("bot_desired_state"), "running")
        restart_token = bot_config.get("bot_restart_token", "")

        if desired_state == "running":
            should_restart = bool(restart_token and restart_token != last_restart_token)
            if scheduler_running and should_restart:
                logger.info("Restart command received; restarting scheduler")
                scheduler.stop()
                scheduler_running = False
            if not scheduler_running:
                scheduler.start()
                scheduler_running = True
            if should_restart:
                last_restart_token = restart_token
            update_runtime_state("running", force=should_restart)
            return

        if scheduler_running:
            logger.info("Applying bot state: %s", desired_state)
            scheduler.stop()
            scheduler_running = False
        update_runtime_state(desired_state)

    def handle_shutdown(sig, frame):
        logger.info("Shutting down scheduler...")
        if scheduler_running:
            scheduler.stop()
        try:
            db.set_bot_config_values({"bot_actual_state": "offline"})
        except Exception:
            logger.exception("Error updating bot runtime state")
        try:
            redis_client.close()
        except Exception:
            logger.exception("Error closing Redis connection")
        try:
            db.close()
        except Exception:
            logger.exception("Error closing database pool")
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    logger.info("Starting Cassandrina trading bot control loop")

    while True:
        try:
            reconcile_scheduler_state()
        except Exception:
            logger.exception("Failed to reconcile bot control state")
        time.sleep(CONTROL_POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
