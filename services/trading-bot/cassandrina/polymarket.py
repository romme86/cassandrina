"""
Polymarket client for Cassandrina.

Provides a compatibility probability lookup plus a richer market signal that
can be used as a confidence modifier without changing Cassandrina's core
scoring rules.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests

logger = logging.getLogger(__name__)

NEUTRAL_PROBABILITY: float = 0.5
_CLOB_BASE_URL = "https://clob.polymarket.com"
_DATA_API_BASE_URL = "https://data-api.polymarket.com"
_GAMMA_BASE_URL = "https://gamma-api.polymarket.com"
_BTC_KEYWORDS = ("bitcoin", "btc")
_ABOVE_KEYWORDS = ("above", "over", "reach", "hit")
_BELOW_KEYWORDS = ("below", "under")


@dataclass(slots=True)
class PolymarketSignal:
    available: bool = False
    aligned_probability: float = NEUTRAL_PROBABILITY
    alignment_score: float = 50.0
    trade_imbalance_score: float = 50.0
    price_momentum_score: float = 50.0
    question: str | None = None
    condition_id: str | None = None
    matched_price: float | None = None
    favored_outcome: str | None = None


class PolymarketClient:
    def __init__(self, api_key: str | None = None, timeout: int = 10):
        self._session = requests.Session()
        self._timeout = timeout
        if api_key:
            self._session.headers["Authorization"] = f"Bearer {api_key}"

    def fetch_btc_probability(self, target_date: date) -> float:
        """
        Return the implied probability (0–1) for the best BTC market on
        *target_date*. Falls back to NEUTRAL_PROBABILITY on errors.
        """
        try:
            markets = self._fetch_markets()
        except Exception as exc:
            logger.warning("Polymarket API error: %s — using neutral probability", exc)
            return NEUTRAL_PROBABILITY

        best = self._find_best_market(markets, target_date=target_date)
        if best is None:
            return NEUTRAL_PROBABILITY

        return self._probability_for_outcome(best, "Yes")

    def build_market_signal(
        self,
        *,
        target_date: date,
        target_price: float,
        direction: str,
        lookback_minutes: int = 60,
        max_distance_pct: float = 5.0,
    ) -> PolymarketSignal:
        try:
            markets = self._fetch_markets()
            matched = self._find_best_market(
                markets,
                target_date=target_date,
                target_price=target_price,
                direction=direction,
                max_distance_pct=max_distance_pct,
            )
            if matched is None:
                return PolymarketSignal()

            favored_outcome = self._determine_favored_outcome(matched, direction)
            aligned_probability = self._probability_for_outcome(matched, favored_outcome)
            condition_id = self._market_condition_id(matched)
            token_id = self._token_id_for_outcome(matched, favored_outcome)
            question = matched.get("question")

            trade_imbalance_score = 50.0
            if condition_id:
                trades = self._fetch_trades(condition_id, limit=200)
                trade_imbalance_score = self._trade_imbalance_score(trades, favored_outcome)

            price_momentum_score = 50.0
            if token_id:
                end_time = datetime.now(timezone.utc)
                start_time = end_time - timedelta(minutes=lookback_minutes)
                history = self._fetch_price_history(
                    token_id,
                    start_ts=int(start_time.timestamp()),
                    end_ts=int(end_time.timestamp()),
                )
                price_momentum_score = self._price_momentum_score(history)

            alignment_score = _clamp(
                aligned_probability * 100.0 * 0.50
                + trade_imbalance_score * 0.35
                + price_momentum_score * 0.15,
                0.0,
                100.0,
            )
            return PolymarketSignal(
                available=True,
                aligned_probability=aligned_probability,
                alignment_score=alignment_score,
                trade_imbalance_score=trade_imbalance_score,
                price_momentum_score=price_momentum_score,
                question=str(question) if question is not None else None,
                condition_id=condition_id,
                matched_price=self._extract_threshold_price(str(question or "")),
                favored_outcome=favored_outcome,
            )
        except Exception:
            logger.exception("Failed to build Polymarket signal")
            return PolymarketSignal()

    def _fetch_markets(self) -> list[dict]:
        resp = self._session.get(
            f"{_GAMMA_BASE_URL}/markets",
            params={"active": "true", "closed": "false", "limit": 500},
            timeout=self._timeout,
        )
        if not resp.ok:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")
        payload = resp.json()
        if isinstance(payload, dict):
            data = payload.get("data", [])
            return data if isinstance(data, list) else []
        return payload if isinstance(payload, list) else []

    def _fetch_trades(self, condition_id: str, *, limit: int) -> list[dict]:
        resp = self._session.get(
            f"{_DATA_API_BASE_URL}/trades",
            params={"market": condition_id, "limit": limit},
            timeout=self._timeout,
        )
        if not resp.ok:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")
        payload = resp.json()
        if isinstance(payload, dict):
            data = payload.get("data", [])
            return data if isinstance(data, list) else []
        return payload if isinstance(payload, list) else []

    def _fetch_price_history(self, token_id: str, *, start_ts: int, end_ts: int) -> list[dict]:
        resp = self._session.get(
            f"{_CLOB_BASE_URL}/prices-history",
            params={
                "market": token_id,
                "startTs": start_ts,
                "endTs": end_ts,
                "interval": "1h",
                "fidelity": 1,
            },
            timeout=self._timeout,
        )
        if not resp.ok:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")
        payload = resp.json()
        history = payload.get("history", [])
        return history if isinstance(history, list) else []

    def _find_best_market(
        self,
        markets: list[dict],
        *,
        target_date: date,
        target_price: float | None = None,
        direction: str | None = None,
        max_distance_pct: float | None = None,
    ) -> dict | None:
        candidates: list[tuple[float, dict]] = []
        for market in markets:
            question = str(market.get("question", "")).lower()
            if not any(keyword in question for keyword in _BTC_KEYWORDS):
                continue
            if market.get("active") is False:
                continue
            if not self._matches_target_date(market, target_date):
                continue

            threshold_price = self._extract_threshold_price(question)
            if target_price is not None:
                if threshold_price is None or threshold_price <= 0:
                    continue
                distance_pct = abs(threshold_price - target_price) / target_price * 100.0
                if max_distance_pct is not None and distance_pct > max_distance_pct:
                    continue
                score = 100.0 - distance_pct
                if direction == "long" and any(keyword in question for keyword in _ABOVE_KEYWORDS):
                    score += 5.0
                if direction == "short" and any(keyword in question for keyword in _BELOW_KEYWORDS):
                    score += 5.0
            else:
                score = 1.0
                if threshold_price is not None:
                    score += 1.0
            candidates.append((score, market))

        if not candidates:
            return None
        candidates.sort(key=lambda item: item[0], reverse=True)
        return candidates[0][1]

    def _matches_target_date(self, market: dict, target_date: date) -> bool:
        raw_date = (
            market.get("endDate")
            or market.get("end_date")
            or market.get("endDateIso")
            or market.get("end_date_iso")
            or market.get("endDateISO")
        )
        if raw_date:
            try:
                parsed = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00")).date()
                return parsed == target_date
            except ValueError:
                pass
        question = str(market.get("question", "")).lower()
        date_str_full = target_date.strftime("%B %-d").lower()
        date_str_month = target_date.strftime("%B").lower()
        date_str_year = str(target_date.year)
        return date_str_full in question or (date_str_month in question and date_str_year in question)

    @staticmethod
    def _extract_threshold_price(question: str) -> float | None:
        matches = re.findall(r"\$?([0-9]{2,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)", question)
        if not matches:
            return None
        try:
            return float(matches[0].replace(",", ""))
        except ValueError:
            return None

    def _determine_favored_outcome(self, market: dict, direction: str) -> str:
        question = str(market.get("question", "")).lower()
        if any(keyword in question for keyword in _ABOVE_KEYWORDS):
            return "Yes" if direction == "long" else "No"
        if any(keyword in question for keyword in _BELOW_KEYWORDS):
            return "Yes" if direction == "short" else "No"
        return "Yes" if direction == "long" else "No"

    def _probability_for_outcome(self, market: dict, outcome: str) -> float:
        outcomes = self._parse_maybe_json_list(market.get("outcomes"))
        prices = self._parse_maybe_json_list(market.get("outcomePrices"))
        if not outcomes or not prices:
            return NEUTRAL_PROBABILITY
        try:
            index = outcomes.index(outcome)
            return _clamp(float(prices[index]), 0.0, 1.0)
        except (ValueError, IndexError, TypeError):
            return NEUTRAL_PROBABILITY

    def _token_id_for_outcome(self, market: dict, outcome: str) -> str | None:
        token_ids = self._parse_maybe_json_list(
            market.get("clobTokenIds")
            or market.get("clob_token_ids")
            or market.get("tokenIds")
            or market.get("token_ids")
        )
        outcomes = self._parse_maybe_json_list(market.get("outcomes"))
        if not token_ids or not outcomes:
            return None
        try:
            return str(token_ids[outcomes.index(outcome)])
        except (ValueError, IndexError):
            return None

    @staticmethod
    def _market_condition_id(market: dict) -> str | None:
        value = market.get("conditionId") or market.get("condition_id")
        return str(value) if value else None

    @staticmethod
    def _parse_maybe_json_list(value: Any) -> list[Any]:
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                return parsed if isinstance(parsed, list) else []
            except json.JSONDecodeError:
                return []
        return []

    @staticmethod
    def _trade_imbalance_score(trades: list[dict], favored_outcome: str) -> float:
        if not trades:
            return 50.0
        favored = favored_outcome.lower()
        net = 0.0
        total = 0.0
        for trade in trades:
            outcome = str(trade.get("outcome", "")).lower()
            side = str(trade.get("side", "")).upper()
            price = _safe_float(trade.get("price"), 0.0)
            size = _safe_float(trade.get("size"), _safe_float(trade.get("amount"), 0.0))
            notional = abs(price * size)
            if notional == 0:
                continue
            total += notional
            favors_outcome = outcome == favored
            if favors_outcome and side == "BUY":
                net += notional
            elif favors_outcome and side == "SELL":
                net -= notional
            elif not favors_outcome and side == "BUY":
                net -= notional
            elif not favors_outcome and side == "SELL":
                net += notional
        if total == 0:
            return 50.0
        return _clamp(50.0 + (net / total) * 50.0, 0.0, 100.0)

    @staticmethod
    def _price_momentum_score(history: list[dict]) -> float:
        if len(history) < 2:
            return 50.0
        start_price = _safe_float(history[0].get("p"), 0.5)
        end_price = _safe_float(history[-1].get("p"), start_price)
        delta = end_price - start_price
        return _clamp(50.0 + delta * 100.0, 0.0, 100.0)


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))
