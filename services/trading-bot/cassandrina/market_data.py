"""
Market data client for public BTC pricing.
"""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests


class MarketDataClient:
    def __init__(self, timeout: int = 10):
        self._timeout = timeout

    def get_btc_price(self, symbol: str = "BTCUSDT") -> float:
        resp = requests.get(
            "https://api.binance.com/api/v3/ticker/price",
            params={"symbol": symbol},
            timeout=self._timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        return float(data["price"])

    def get_btc_day_range(
        self,
        *,
        target_time: datetime,
        time_zone: str,
        symbol: str = "BTCUSDT",
    ) -> tuple[float, float]:
        target_local = target_time.astimezone(ZoneInfo(time_zone))
        day_start_local = target_local.replace(hour=0, minute=0, second=0, microsecond=0)

        start_ms = int(day_start_local.astimezone(timezone.utc).timestamp() * 1000)
        end_ms = int(target_local.astimezone(timezone.utc).timestamp() * 1000)

        resp = requests.get(
            "https://api.binance.com/api/v3/klines",
            params={
                "symbol": symbol,
                "interval": "1m",
                "startTime": start_ms,
                "endTime": end_ms,
                "limit": 1500,
            },
            timeout=self._timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        if not data:
            raise RuntimeError("No Binance kline data returned for the requested range")

        lows = [float(candle[3]) for candle in data]
        highs = [float(candle[2]) for candle in data]
        return min(lows), max(highs)
