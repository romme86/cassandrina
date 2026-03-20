"""
Market data client for public BTC pricing.
"""

from __future__ import annotations

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
