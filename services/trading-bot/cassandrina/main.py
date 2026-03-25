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
from dotenv import load_dotenv

from cassandrina.binance_client import BinanceClientWrapper
from cassandrina.lnd_client import LNDClient
from cassandrina.market_data import MarketDataClient
from cassandrina.polymarket import PolymarketClient
from cassandrina.repository import PostgresRepository
from cassandrina.scheduler import PredictionScheduler, SchedulerConfig
from cassandrina.trade_executor import TradeExecutor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


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
