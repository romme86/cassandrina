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
_MARKETS_PAGE_SIZE = 500
_MARKET_POSITIONS_PAGE_SIZE = 500
_PRICE_PREDICTION_WINDOWS = {
    "day": 1,
    "week": 7,
    "month": 30,
}


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
        return self._fetch_all_markets(
            params={
                "active": "true",
                "closed": "false",
                "archived": "false",
            }
        )

    def build_bitcoin_market_recap(self, *, as_of: datetime | None = None) -> dict[str, Any]:
        snapshot_at = as_of or datetime.now(timezone.utc)
        markets = self._fetch_markets()
        bitcoin_markets = [
            market for market in markets if self._is_bitcoin_market(market) and not bool(market.get("closed"))
        ]
        bitcoin_markets.sort(
            key=lambda market: (
                self._parse_market_end_datetime(market) or datetime.max.replace(tzinfo=timezone.utc),
                -_safe_float(market.get("liquidityNum"), _safe_float(market.get("liquidity"))),
                -_safe_float(market.get("volume24hr"), _safe_float(market.get("volumeNum"), _safe_float(market.get("volume")))),
            )
        )
        market_summaries = [self._summarize_market(market) for market in bitcoin_markets]
        price_predictions = self._build_price_predictions(bitcoin_markets, snapshot_at=snapshot_at)
        return {
            "snapshot_at": snapshot_at.isoformat(),
            "market_count": len(market_summaries),
            "markets": market_summaries,
            "price_predictions": price_predictions,
        }

    def fetch_market_participants(self, condition_id: str) -> list[dict[str, Any]]:
        grouped_positions = self._fetch_market_positions(condition_id)
        aggregated: dict[str, dict[str, Any]] = {}
        for grouped in grouped_positions:
            outcome_label = str(grouped.get("token") or grouped.get("outcome") or "").strip()
            positions = grouped.get("positions", [])
            if not isinstance(positions, list):
                continue
            for position in positions:
                if not isinstance(position, dict):
                    continue
                wallet = str(position.get("proxyWallet") or "").strip().lower()
                if not wallet:
                    continue
                total_bought = _safe_float(position.get("totalBought"))
                current_value = _safe_float(position.get("currentValue"))
                size = _safe_float(position.get("size"))
                if total_bought <= 0 and current_value <= 0 and size <= 0:
                    continue
                participant = aggregated.setdefault(
                    wallet,
                    {
                        "proxy_wallet": wallet,
                        "display_name": str(position.get("name") or "").strip() or wallet,
                        "profile_image": str(position.get("profileImage") or "").strip() or None,
                        "verified": bool(position.get("verified")),
                        "outcomes": set(),
                        "total_bought": 0.0,
                        "size": 0.0,
                        "current_value": 0.0,
                        "cash_pnl": 0.0,
                        "realized_pnl": 0.0,
                        "total_pnl": 0.0,
                        "_avg_price_weighted": 0.0,
                        "_curr_price_weighted": 0.0,
                    },
                )
                if outcome_label:
                    participant["outcomes"].add(outcome_label)
                participant["display_name"] = str(position.get("name") or participant["display_name"]).strip() or participant["display_name"]
                profile_image = str(position.get("profileImage") or "").strip()
                if profile_image:
                    participant["profile_image"] = profile_image
                participant["verified"] = participant["verified"] or bool(position.get("verified"))
                participant["total_bought"] += total_bought
                participant["size"] += size
                participant["current_value"] += current_value
                participant["cash_pnl"] += _safe_float(position.get("cashPnl"))
                participant["realized_pnl"] += _safe_float(position.get("realizedPnl"))
                participant["total_pnl"] += _safe_float(position.get("totalPnl"))
                participant["_avg_price_weighted"] += _safe_float(position.get("avgPrice")) * total_bought
                participant["_curr_price_weighted"] += _safe_float(position.get("currPrice")) * max(size, 0.0)

        participants: list[dict[str, Any]] = []
        for participant in aggregated.values():
            total_bought = participant["total_bought"]
            size = participant["size"]
            participants.append(
                {
                    "proxy_wallet": participant["proxy_wallet"],
                    "display_name": participant["display_name"],
                    "profile_image": participant["profile_image"],
                    "verified": participant["verified"],
                    "outcomes": sorted(participant["outcomes"]),
                    "total_bought": total_bought,
                    "avg_price": (
                        participant["_avg_price_weighted"] / total_bought if total_bought > 0 else None
                    ),
                    "size": size,
                    "current_price": (
                        participant["_curr_price_weighted"] / size if size > 0 else None
                    ),
                    "current_value": participant["current_value"],
                    "cash_pnl": participant["cash_pnl"],
                    "realized_pnl": participant["realized_pnl"],
                    "total_pnl": participant["total_pnl"],
                }
            )
        participants.sort(key=lambda item: (-item["total_bought"], item["proxy_wallet"]))
        return participants

    def _fetch_all_markets(self, *, params: dict[str, Any]) -> list[dict]:
        offset = 0
        markets: list[dict] = []
        while True:
            response = self._session.get(
                f"{_GAMMA_BASE_URL}/markets",
                params={**params, "limit": _MARKETS_PAGE_SIZE, "offset": offset},
                timeout=self._timeout,
            )
            if not response.ok:
                raise RuntimeError(f"HTTP {response.status_code}: {response.text}")
            payload = response.json()
            if isinstance(payload, dict):
                batch = payload.get("data", [])
            else:
                batch = payload
            if not isinstance(batch, list) or not batch:
                break
            markets.extend(item for item in batch if isinstance(item, dict))
            if len(batch) < _MARKETS_PAGE_SIZE:
                break
            offset += _MARKETS_PAGE_SIZE
        return markets

    def _fetch_market_positions(self, condition_id: str) -> list[dict]:
        offset = 0
        positions: list[dict] = []
        while True:
            response = self._session.get(
                f"{_DATA_API_BASE_URL}/v1/market-positions",
                params={
                    "market": condition_id,
                    "limit": _MARKET_POSITIONS_PAGE_SIZE,
                    "offset": offset,
                },
                timeout=self._timeout,
            )
            if not response.ok:
                raise RuntimeError(f"HTTP {response.status_code}: {response.text}")
            payload = response.json()
            batch = payload.get("data", []) if isinstance(payload, dict) else payload
            if not isinstance(batch, list) or not batch:
                break
            positions.extend(item for item in batch if isinstance(item, dict))
            if len(batch) < _MARKET_POSITIONS_PAGE_SIZE:
                break
            offset += _MARKET_POSITIONS_PAGE_SIZE
        return positions

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

    def _build_price_predictions(
        self,
        markets: list[dict],
        *,
        snapshot_at: datetime,
    ) -> dict[str, dict[str, Any]]:
        predictions: dict[str, dict[str, Any]] = {}
        for horizon, days in _PRICE_PREDICTION_WINDOWS.items():
            end_date = snapshot_at.date() + timedelta(days=days - 1)
            horizon_markets = [
                market for market in markets if self._market_is_within_horizon(market, end_date=end_date)
            ]
            threshold_markets = self._extract_threshold_probabilities(horizon_markets)
            estimate = self._estimate_implied_price(threshold_markets)
            predictions[horizon] = {
                "window_days": days,
                "market_count": len(horizon_markets),
                "threshold_market_count": len(threshold_markets),
                "estimated_price": estimate,
            }
        return predictions

    def _summarize_market(self, market: dict) -> dict[str, Any]:
        outcomes = self._parse_maybe_json_list(market.get("outcomes"))
        prices = self._parse_maybe_json_list(market.get("outcomePrices"))
        outcome_prices: list[dict[str, Any]] = []
        for index, outcome in enumerate(outcomes):
            if index >= len(prices):
                continue
            outcome_prices.append(
                {
                    "label": str(outcome),
                    "price": _safe_float(prices[index], 0.0),
                }
            )
        return {
            "condition_id": self._market_condition_id(market),
            "slug": market.get("slug"),
            "question": str(market.get("question") or "").strip(),
            "category": str(market.get("category") or "").strip() or None,
            "event_title": self._market_event_title(market),
            "end_date": (
                self._parse_market_end_datetime(market).isoformat()
                if self._parse_market_end_datetime(market) is not None
                else None
            ),
            "threshold_price": self._extract_threshold_price(str(market.get("question") or "")),
            "threshold_direction": self._threshold_direction(str(market.get("question") or "")),
            "outcomes": outcome_prices,
            "liquidity": _safe_float(market.get("liquidityNum"), _safe_float(market.get("liquidity"))),
            "volume": _safe_float(market.get("volumeNum"), _safe_float(market.get("volume"))),
            "volume24hr": _safe_float(market.get("volume24hr")),
            "volume1wk": _safe_float(market.get("volume1wk")),
            "volume1mo": _safe_float(market.get("volume1mo")),
            "last_trade_price": _safe_float(market.get("lastTradePrice")),
            "best_bid": _safe_float(market.get("bestBid")),
            "best_ask": _safe_float(market.get("bestAsk")),
        }

    def _extract_threshold_probabilities(self, markets: list[dict]) -> list[tuple[float, float]]:
        threshold_probabilities: list[tuple[float, float]] = []
        for market in markets:
            question = str(market.get("question") or "")
            threshold = self._extract_threshold_price(question)
            relation = self._threshold_direction(question)
            if threshold is None or relation is None:
                continue
            yes_probability = self._probability_for_outcome(market, "Yes")
            probability_above = yes_probability if relation == "above" else 1.0 - yes_probability
            threshold_probabilities.append((threshold, _clamp(probability_above, 0.0, 1.0)))
        threshold_probabilities.sort(key=lambda item: item[0])
        return _collapse_threshold_probabilities(threshold_probabilities)

    def _estimate_implied_price(self, threshold_probabilities: list[tuple[float, float]]) -> float | None:
        if not threshold_probabilities:
            return None
        if len(threshold_probabilities) == 1:
            return threshold_probabilities[0][0]

        first_threshold, first_probability = threshold_probabilities[0]
        if first_probability <= 0.5:
            return first_threshold

        for previous, current in zip(threshold_probabilities, threshold_probabilities[1:]):
            previous_threshold, previous_probability = previous
            current_threshold, current_probability = current
            if previous_probability >= 0.5 >= current_probability:
                if previous_probability == current_probability:
                    return (previous_threshold + current_threshold) / 2.0
                weight = (previous_probability - 0.5) / max(previous_probability - current_probability, 1e-9)
                return previous_threshold + (current_threshold - previous_threshold) * weight

        return threshold_probabilities[-1][0]

    @staticmethod
    def _threshold_direction(question: str) -> str | None:
        lowered = question.lower()
        if any(keyword in lowered for keyword in _ABOVE_KEYWORDS):
            return "above"
        if any(keyword in lowered for keyword in _BELOW_KEYWORDS):
            return "below"
        return None

    @staticmethod
    def _market_event_title(market: dict) -> str | None:
        events = market.get("events")
        if not isinstance(events, list):
            return None
        for event in events:
            if isinstance(event, dict):
                title = str(event.get("title") or "").strip()
                if title:
                    return title
        return None

    def _is_bitcoin_market(self, market: dict) -> bool:
        haystacks: list[str] = []
        for value in (
            market.get("question"),
            market.get("slug"),
            market.get("category"),
            self._market_event_title(market),
        ):
            if value:
                haystacks.append(str(value).lower())
        tags = market.get("tags")
        if isinstance(tags, list):
            for tag in tags:
                if isinstance(tag, dict):
                    label = str(tag.get("label") or tag.get("slug") or "").lower()
                    if label:
                        haystacks.append(label)
        joined = " ".join(haystacks)
        return any(keyword in joined for keyword in _BTC_KEYWORDS)

    def _market_is_within_horizon(self, market: dict, *, end_date: date) -> bool:
        market_end = self._parse_market_end_datetime(market)
        if market_end is None:
            return False
        return market_end.date() <= end_date

    @staticmethod
    def _parse_market_end_datetime(market: dict) -> datetime | None:
        raw_value = (
            market.get("endDate")
            or market.get("end_date")
            or market.get("endDateIso")
            or market.get("end_date_iso")
            or market.get("endDateISO")
        )
        if not raw_value:
            return None
        try:
            parsed = datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

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


def _collapse_threshold_probabilities(
    threshold_probabilities: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    if not threshold_probabilities:
        return []
    collapsed: list[tuple[float, float]] = []
    current_threshold = threshold_probabilities[0][0]
    values: list[float] = []
    for threshold, probability in threshold_probabilities:
        if threshold != current_threshold:
            collapsed.append((current_threshold, sum(values) / len(values)))
            current_threshold = threshold
            values = []
        values.append(probability)
    collapsed.append((current_threshold, sum(values) / len(values)))
    return collapsed
