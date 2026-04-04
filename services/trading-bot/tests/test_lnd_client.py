"""
TDD — LND REST client tests.
All HTTP calls are mocked; no live LND node required.
Run: pytest tests/test_lnd_client.py
"""

import pytest
import responses as resp_lib
from responses import RequestsMock

from cassandrina.lnd_client import LNDClient, LNDError


LND_HOST = "192.168.1.100"
LND_PORT = 8080
MACAROON = "deadbeef" * 8   # 64-char fake hex macaroon
BASE_URL = f"https://{LND_HOST}:{LND_PORT}"


@pytest.fixture
def client():
    return LNDClient(host=LND_HOST, port=LND_PORT, macaroon_hex=MACAROON, verify_tls=False)


# ── Invoice creation ─────────────────────────────────────────

class TestCreateInvoice:
    @resp_lib.activate
    def test_creates_invoice_returns_payment_request(self, client):
        resp_lib.add(
            resp_lib.POST,
            f"{BASE_URL}/v1/invoices",
            json={
                "r_hash": "abc123",
                "payment_request": "lnbc1000n1...",
                "add_index": "1",
            },
            status=200,
        )
        invoice = client.create_invoice(amount_sats=1000, memo="Test prediction", expiry=3600)
        assert invoice["payment_request"] == "lnbc1000n1..."

    @resp_lib.activate
    def test_invoice_request_includes_correct_amount(self, client):
        resp_lib.add(
            resp_lib.POST,
            f"{BASE_URL}/v1/invoices",
            json={"r_hash": "abc", "payment_request": "lnbc...", "add_index": "2"},
            status=200,
        )
        client.create_invoice(amount_sats=500, memo="Prediction", expiry=3600)
        request_body = resp_lib.calls[0].request.body
        import json
        body = json.loads(request_body)
        assert body["value"] == 500

    @resp_lib.activate
    def test_invoice_request_includes_memo(self, client):
        resp_lib.add(
            resp_lib.POST,
            f"{BASE_URL}/v1/invoices",
            json={"r_hash": "abc", "payment_request": "lnbc...", "add_index": "3"},
            status=200,
        )
        client.create_invoice(amount_sats=100, memo="Round 42", expiry=1800)
        import json
        body = json.loads(resp_lib.calls[0].request.body)
        assert body["memo"] == "Round 42"

    @resp_lib.activate
    def test_invoice_creation_raises_on_http_error(self, client):
        resp_lib.add(
            resp_lib.POST,
            f"{BASE_URL}/v1/invoices",
            json={"error": "permission denied"},
            status=403,
        )
        with pytest.raises(LNDError):
            client.create_invoice(amount_sats=100, memo="fail", expiry=3600)


# ── Payment verification ─────────────────────────────────────

class TestVerifyPayment:
    @resp_lib.activate
    def test_settled_invoice_returns_true(self, client):
        r_hash_hex = "abc123def456"
        resp_lib.add(
            resp_lib.GET,
            f"{BASE_URL}/v1/invoice/{r_hash_hex}",
            json={"settled": True, "value": "1000", "amt_paid_sat": "1000"},
            status=200,
        )
        result = client.verify_payment(r_hash_hex=r_hash_hex)
        assert result["settled"] is True
        assert result["amount_sats"] == 1000

    @resp_lib.activate
    def test_unsettled_invoice_returns_false(self, client):
        r_hash_hex = "abc123"
        resp_lib.add(
            resp_lib.GET,
            f"{BASE_URL}/v1/invoice/{r_hash_hex}",
            json={"settled": False, "value": "500", "amt_paid_sat": "0"},
            status=200,
        )
        result = client.verify_payment(r_hash_hex=r_hash_hex)
        assert result["settled"] is False

    @resp_lib.activate
    def test_verify_payment_raises_on_404(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{BASE_URL}/v1/invoice/notfound",
            json={"error": "not found"},
            status=404,
        )
        with pytest.raises(LNDError):
            client.verify_payment(r_hash_hex="notfound")


# ── Channel balance ──────────────────────────────────────────

class TestChannelBalance:
    @resp_lib.activate
    def test_returns_local_balance_sats(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{BASE_URL}/v1/balance/channels",
            json={"local_balance": {"sat": "50000"}, "remote_balance": {"sat": "30000"}},
            status=200,
        )
        balance = client.get_channel_balance()
        assert balance["local_sats"] == 50000
        assert balance["remote_sats"] == 30000

    @resp_lib.activate
    def test_balance_raises_on_error(self, client):
        resp_lib.add(
            resp_lib.GET,
            f"{BASE_URL}/v1/balance/channels",
            json={"error": "server error"},
            status=500,
        )
        with pytest.raises(LNDError):
            client.get_channel_balance()


class TestTLSConfig:
    def test_skip_verify_env_takes_precedence_over_cert_path(self, monkeypatch):
        monkeypatch.setenv("LND_HOST", LND_HOST)
        monkeypatch.setenv("LND_PORT", str(LND_PORT))
        monkeypatch.setenv("LND_MACAROON_HEX", MACAROON)
        monkeypatch.setenv("LND_TLS_SKIP_VERIFY", "true")
        monkeypatch.setenv("LND_TLS_CERT_PATH", "/path/to/tls.cert")

        client = LNDClient()

        assert client.verify is False
        assert client._session.verify is False
