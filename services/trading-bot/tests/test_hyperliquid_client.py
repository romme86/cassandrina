from cassandrina.hyperliquid_client import HyperliquidClient


class DummyResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


class DummySession:
    def __init__(self, payload):
        self.payload = payload

    def post(self, url, json, timeout):
        return DummyResponse(self.payload)


def test_quantize_uses_live_meta_size_decimals():
    payload = [
        {"universe": [{"name": "BTC", "szDecimals": 5}]},
        [{"priceDecimals": 2}],
    ]
    client = HyperliquidClient(
        account_address="0xabc",
        agent_private_key="0xdef",
        session=DummySession(payload),
    )

    size = client.quantize_btc_amount(5_000, symbol="BTCUSDT")

    assert size.quantity_btc == 0.00005
    assert size.min_size_btc == 0.00001
    assert size.skipped is False


def test_quantize_skips_below_minimum_increment():
    payload = [
        {"universe": [{"name": "BTC", "szDecimals": 5}]},
        [{"priceDecimals": 2}],
    ]
    client = HyperliquidClient(
        account_address="0xabc",
        agent_private_key="0xdef",
        session=DummySession(payload),
    )

    size = client.quantize_btc_amount(100, symbol="BTCUSDT")

    assert size.skipped is True
    assert "minimum size increment" in size.reason
