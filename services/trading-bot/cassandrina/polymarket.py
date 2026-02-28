"""
Polymarket REST client for Cassandrina.

Fetches the implied probability that Bitcoin will reach the target price
from Polymarket's CLOB API. Falls back to NEUTRAL_PROBABILITY (0.5)
when no matching market is found or on API errors.

Docs: https://docs.polymarket.com/
"""

from __future__ import annotations

import logging
from datetime import date

import requests

logger = logging.getLogger(__name__)

NEUTRAL_PROBABILITY: float = 0.5
_BASE_URL = "https://clob.polymarket.com"
_BTC_KEYWORDS = ("bitcoin", "btc")


class PolymarketClient:
    def __init__(self, api_key: str | None = None, timeout: int = 10):
        self._session = requests.Session()
        self._timeout = timeout
        if api_key:
            self._session.headers["Authorization"] = f"Bearer {api_key}"

    def fetch_btc_probability(self, target_date: date) -> float:
        """
        Return the implied probability (0–1) that BTC will hit a target
        on *target_date* as derived from the most relevant Polymarket market.

        Returns NEUTRAL_PROBABILITY if no matching market is found or
        if the API call fails.
        """
        try:
            markets = self._fetch_markets()
        except Exception as exc:
            logger.warning("Polymarket API error: %s — using neutral probability", exc)
            return NEUTRAL_PROBABILITY

        best = self._find_best_market(markets, target_date)
        if best is None:
            return NEUTRAL_PROBABILITY

        return self._extract_yes_probability(best)

    def _fetch_markets(self) -> list[dict]:
        resp = self._session.get(f"{_BASE_URL}/markets", timeout=self._timeout)
        if not resp.ok:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")
        return resp.json().get("data", [])

    def _find_best_market(self, markets: list[dict], target_date: date) -> dict | None:
        """Return the first active BTC market whose question mentions the date or BTC."""
        date_str = target_date.strftime("%B %-d")   # e.g. "March 1"
        for market in markets:
            question = market.get("question", "").lower()
            if not any(kw in question for kw in _BTC_KEYWORDS):
                continue
            if not market.get("active", False):
                continue
            return market
        return None

    @staticmethod
    def _extract_yes_probability(market: dict) -> float:
        """Parse the 'Yes' outcome price as a probability."""
        try:
            outcome_prices = market.get("outcomePrices", [])
            outcomes = market.get("outcomes", [])
            if "Yes" in outcomes:
                idx = outcomes.index("Yes")
                return float(outcome_prices[idx])
            # Fallback: first price
            return float(outcome_prices[0])
        except (IndexError, ValueError, TypeError):
            return NEUTRAL_PROBABILITY
