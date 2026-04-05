"""
Polymarket client tests.
"""

from datetime import date, datetime, timezone

import pytest
import responses as resp_lib

from cassandrina.polymarket import (
    NEUTRAL_PROBABILITY,
    PolymarketClient,
)


GAMMA_BASE = "https://gamma-api.polymarket.com"
DATA_API_BASE = "https://data-api.polymarket.com"
CLOB_BASE = "https://clob.polymarket.com"


@pytest.fixture
def client():
    return PolymarketClient()


class TestFetchBtcProbability:
    @resp_lib.activate
    def test_returns_probability_for_matching_market(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{GAMMA_BASE}/markets",
            json=[
                {
                    "question": "Will Bitcoin be above $95,000 on March 1, 2026?",
                    "outcomePrices": ["0.72", "0.28"],
                    "outcomes": ["Yes", "No"],
                    "active": True,
                    "endDate": "2026-03-01T23:59:59Z",
                }
            ],
            status=200,
        )
        prob = client.fetch_btc_probability(target_date=date(2026, 3, 1))
        assert prob == pytest.approx(0.72, abs=0.01)

    @resp_lib.activate
    def test_returns_neutral_when_no_matching_market(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{GAMMA_BASE}/markets",
            json=[],
            status=200,
        )
        prob = client.fetch_btc_probability(target_date=date(2026, 3, 1))
        assert prob == NEUTRAL_PROBABILITY

    @resp_lib.activate
    def test_returns_neutral_on_api_error(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{GAMMA_BASE}/markets",
            json={"error": "rate limited"},
            status=429,
        )
        prob = client.fetch_btc_probability(target_date=date(2026, 3, 1))
        assert prob == NEUTRAL_PROBABILITY


class TestBuildMarketSignal:
    @resp_lib.activate
    def test_builds_signal_from_probability_trades_and_history(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{GAMMA_BASE}/markets",
            json=[
                {
                    "question": "Will Bitcoin be above $105,000 on March 1, 2026?",
                    "outcomePrices": ["0.65", "0.35"],
                    "outcomes": ["Yes", "No"],
                    "clobTokenIds": ["yes-token", "no-token"],
                    "conditionId": "cond-1",
                    "active": True,
                    "endDate": "2026-03-01T23:59:59Z",
                }
            ],
            status=200,
        )
        resp_lib.add(
            resp_lib.GET,
            f"{DATA_API_BASE}/trades",
            json=[
                {"outcome": "Yes", "side": "BUY", "price": 0.6, "size": 100},
                {"outcome": "Yes", "side": "BUY", "price": 0.65, "size": 80},
                {"outcome": "No", "side": "BUY", "price": 0.35, "size": 20},
            ],
            status=200,
        )
        resp_lib.add(
            resp_lib.GET,
            f"{CLOB_BASE}/prices-history",
            json={"history": [{"t": 1, "p": 0.50}, {"t": 2, "p": 0.65}]},
            status=200,
        )

        signal = client.build_market_signal(
            target_date=date(2026, 3, 1),
            target_price=106_000,
            direction="long",
            lookback_minutes=60,
            max_distance_pct=5.0,
        )
        assert signal.available is True
        assert signal.aligned_probability == pytest.approx(0.65)
        assert signal.trade_imbalance_score > 50.0
        assert signal.price_momentum_score > 50.0
        assert signal.alignment_score > 50.0

    @resp_lib.activate
    def test_returns_unavailable_signal_when_market_is_too_far(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{GAMMA_BASE}/markets",
            json=[
                {
                    "question": "Will Bitcoin be above $150,000 on March 1, 2026?",
                    "outcomePrices": ["0.65", "0.35"],
                    "outcomes": ["Yes", "No"],
                    "clobTokenIds": ["yes-token", "no-token"],
                    "conditionId": "cond-1",
                    "active": True,
                    "endDate": "2026-03-01T23:59:59Z",
                }
            ],
            status=200,
        )

        signal = client.build_market_signal(
            target_date=date(2026, 3, 1),
            target_price=100_000,
            direction="long",
            lookback_minutes=60,
            max_distance_pct=5.0,
        )
        assert signal.available is False


class TestBitcoinMarketRecap:
    @resp_lib.activate
    def test_builds_bitcoin_recap_with_price_predictions(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{GAMMA_BASE}/markets",
            json=[
                {
                    "question": "Will Bitcoin be above $100,000 by April 5, 2026?",
                    "slug": "btc-above-100k-april-5",
                    "conditionId": "cond-day-1",
                    "outcomes": ["Yes", "No"],
                    "outcomePrices": ["0.75", "0.25"],
                    "active": True,
                    "closed": False,
                    "endDate": "2026-04-05T23:59:59Z",
                    "liquidityNum": 125000,
                    "volume24hr": 44000,
                    "volumeNum": 510000,
                },
                {
                    "question": "Will Bitcoin be above $105,000 by April 5, 2026?",
                    "slug": "btc-above-105k-april-5",
                    "conditionId": "cond-day-2",
                    "outcomes": ["Yes", "No"],
                    "outcomePrices": ["0.35", "0.65"],
                    "active": True,
                    "closed": False,
                    "endDate": "2026-04-05T23:59:59Z",
                    "liquidityNum": 99000,
                    "volume24hr": 38000,
                    "volumeNum": 470000,
                },
                {
                    "question": "Will Bitcoin be above $110,000 by April 12, 2026?",
                    "slug": "btc-above-110k-april-12",
                    "conditionId": "cond-week-1",
                    "outcomes": ["Yes", "No"],
                    "outcomePrices": ["0.55", "0.45"],
                    "active": True,
                    "closed": False,
                    "endDate": "2026-04-12T23:59:59Z",
                    "liquidityNum": 150000,
                    "volume24hr": 62000,
                    "volumeNum": 890000,
                },
            ],
            status=200,
        )

        recap = client.build_bitcoin_market_recap(
            as_of=datetime(2026, 4, 5, 16, 0, tzinfo=timezone.utc)
        )

        assert recap["market_count"] == 3
        assert recap["price_predictions"]["day"]["threshold_market_count"] == 2
        assert recap["price_predictions"]["day"]["estimated_price"] == pytest.approx(103333.33, abs=5.0)
        assert recap["price_predictions"]["week"]["threshold_market_count"] == 3
        assert recap["price_predictions"]["month"]["estimated_price"] is not None

    @resp_lib.activate
    def test_fetch_market_participants_aggregates_wallet_across_outcomes(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{DATA_API_BASE}/v1/market-positions",
            json=[
                {
                    "token": "Yes",
                    "positions": [
                        {
                            "proxyWallet": "0xabc",
                            "name": "Satoshi",
                            "profileImage": "https://example.com/satoshi.png",
                            "verified": True,
                            "avgPrice": 0.61,
                            "size": 120,
                            "currPrice": 0.64,
                            "currentValue": 76.8,
                            "cashPnl": 10.0,
                            "realizedPnl": 8.0,
                            "totalPnl": 18.0,
                            "totalBought": 73.2,
                        }
                    ],
                },
                {
                    "token": "No",
                    "positions": [
                        {
                            "proxyWallet": "0xabc",
                            "name": "Satoshi",
                            "verified": True,
                            "avgPrice": 0.42,
                            "size": 40,
                            "currPrice": 0.39,
                            "currentValue": 15.6,
                            "cashPnl": -2.0,
                            "realizedPnl": 1.5,
                            "totalPnl": -0.5,
                            "totalBought": 16.8,
                        },
                        {
                            "proxyWallet": "0xdef",
                            "name": "Hal",
                            "verified": False,
                            "avgPrice": 0.51,
                            "size": 25,
                            "currPrice": 0.52,
                            "currentValue": 13.0,
                            "cashPnl": 0.0,
                            "realizedPnl": 0.0,
                            "totalPnl": 0.25,
                            "totalBought": 12.75,
                        },
                    ],
                },
            ],
            status=200,
        )

        participants = client.fetch_market_participants("cond-1")

        assert len(participants) == 2
        assert participants[0]["proxy_wallet"] == "0xabc"
        assert participants[0]["total_bought"] == pytest.approx(90.0)
        assert participants[0]["outcomes"] == ["No", "Yes"]
        assert participants[0]["avg_price"] == pytest.approx(((0.61 * 73.2) + (0.42 * 16.8)) / 90.0)
