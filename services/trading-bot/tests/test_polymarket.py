"""
TDD — Polymarket client tests.
Mocks HTTP responses; no live API access required.
Run: pytest tests/test_polymarket.py
"""

import pytest
import responses as resp_lib
from datetime import date
from cassandrina.polymarket import PolymarketClient, NEUTRAL_PROBABILITY


POLYMARKET_API_BASE = "https://clob.polymarket.com"


@pytest.fixture
def client():
    return PolymarketClient()


# ── fetch_btc_probability ─────────────────────────────────────

class TestFetchBtcProbability:
    @resp_lib.activate
    def test_returns_probability_for_matching_market(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{POLYMARKET_API_BASE}/markets",
            json={
                "data": [
                    {
                        "question": "Will Bitcoin be above $95,000 on March 1?",
                        "outcomePrices": ["0.72", "0.28"],
                        "outcomes": ["Yes", "No"],
                        "active": True,
                    }
                ]
            },
            status=200,
        )
        prob = client.fetch_btc_probability(target_date=date(2026, 3, 1))
        assert prob == pytest.approx(0.72, abs=0.01)

    @resp_lib.activate
    def test_returns_neutral_when_no_matching_market(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{POLYMARKET_API_BASE}/markets",
            json={"data": []},
            status=200,
        )
        prob = client.fetch_btc_probability(target_date=date(2026, 3, 1))
        assert prob == NEUTRAL_PROBABILITY

    @resp_lib.activate
    def test_returns_neutral_on_api_error(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{POLYMARKET_API_BASE}/markets",
            json={"error": "rate limited"},
            status=429,
        )
        prob = client.fetch_btc_probability(target_date=date(2026, 3, 1))
        assert prob == NEUTRAL_PROBABILITY

    @resp_lib.activate
    def test_returns_neutral_when_no_btc_keyword(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{POLYMARKET_API_BASE}/markets",
            json={
                "data": [
                    {
                        "question": "Will ETH be above $3,000?",
                        "outcomePrices": ["0.60", "0.40"],
                        "outcomes": ["Yes", "No"],
                        "active": True,
                    }
                ]
            },
            status=200,
        )
        prob = client.fetch_btc_probability(target_date=date(2026, 3, 1))
        assert prob == NEUTRAL_PROBABILITY

    def test_neutral_probability_is_0_5(self):
        assert NEUTRAL_PROBABILITY == 0.5

    @resp_lib.activate
    def test_uses_first_yes_outcome_price(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{POLYMARKET_API_BASE}/markets",
            json={
                "data": [
                    {
                        "question": "Bitcoin price above $90k this week?",
                        "outcomePrices": ["0.85", "0.15"],
                        "outcomes": ["Yes", "No"],
                        "active": True,
                    }
                ]
            },
            status=200,
        )
        prob = client.fetch_btc_probability(target_date=date(2026, 3, 1))
        assert prob == pytest.approx(0.85)
