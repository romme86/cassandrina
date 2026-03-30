"""
Polymarket client tests.
"""

from datetime import date

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
