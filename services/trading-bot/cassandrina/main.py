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

import redis

from cassandrina.scheduler import PredictionScheduler, SchedulerConfig

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def main() -> None:
    redis_url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    redis_client = redis.from_url(redis_url, decode_responses=True)

    config = SchedulerConfig(
        prediction_open_hour=int(os.environ.get("PREDICTION_OPEN_HOUR", 8)),
        prediction_target_hour=int(os.environ.get("PREDICTION_TARGET_HOUR", 16)),
        prediction_window_hours=int(os.environ.get("PREDICTION_WINDOW_HOURS", 6)),
        weekly_vote_day=int(os.environ.get("WEEKLY_VOTE_DAY", 6)),
        weekly_vote_hour=int(os.environ.get("WEEKLY_VOTE_HOUR", 20)),
        report_hours_before_target=int(os.environ.get("REPORT_HOURS_BEFORE_TARGET", 8)),
        min_paid_predictions=1,
    )

    # DB stub — in production wire to psycopg2 pool
    class StubDB:
        def create_round(self, **kwargs):
            return {"id": 1}
        def close_round(self, round_id):
            pass
        def get_paid_predictions_count(self, round_id):
            return 0
        def get_round_status(self, round_id):
            from cassandrina.scheduler import RoundStatus
            return RoundStatus.OPEN

    scheduler = PredictionScheduler(
        config=config,
        redis_client=redis_client,
        db=StubDB(),
    )

    def handle_shutdown(sig, frame):
        logger.info("Shutting down scheduler...")
        scheduler.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    logger.info("Starting Cassandrina trading bot scheduler")
    scheduler.start()

    # Keep alive
    while True:
        time.sleep(60)


if __name__ == "__main__":
    main()
