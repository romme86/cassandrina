"""
LND REST API client for Cassandrina.

Connects to an existing LND node via its REST API (port 8080 by default).
Macaroon should be scoped to: invoices:read invoices:write

Required env vars:
    LND_HOST            — IP/hostname of the LND node
    LND_PORT            — REST port (default 8080)
    LND_MACAROON_HEX   — hex-encoded invoice macaroon
    LND_TLS_CERT_PATH  — (optional) path to tls.cert for verification
"""

from __future__ import annotations

import json
import logging
import os
from typing import Iterator

import requests


logger = logging.getLogger(__name__)


class LNDError(Exception):
    """Raised on non-2xx LND API responses or connection errors."""


class LNDClient:
    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
        macaroon_hex: str | None = None,
        verify_tls: bool | str = True,
    ):
        self.host = host or os.environ["LND_HOST"]
        self.port = int(port or os.environ.get("LND_PORT", 8080))
        self.macaroon_hex = macaroon_hex or os.environ["LND_MACAROON_HEX"]
        self.base_url = f"https://{self.host}:{self.port}"

        # verify_tls: True (system CAs), False (skip), or str (cert path)
        if verify_tls is True:
            cert_path = os.environ.get("LND_TLS_CERT_PATH")
            self.verify: bool | str = cert_path if cert_path else True
        else:
            self.verify = verify_tls

        self._session = requests.Session()
        self._session.headers.update({
            "Grpc-Metadata-Macaroon": self.macaroon_hex,
            "Content-Type": "application/json",
        })
        self._session.verify = self.verify

    def _get(self, path: str) -> dict:
        url = f"{self.base_url}{path}"
        try:
            response = self._session.get(url)
        except requests.RequestException as exc:
            raise LNDError(f"GET {path} failed: {exc}") from exc
        if not response.ok:
            raise LNDError(f"GET {path} → HTTP {response.status_code}: {response.text}")
        return response.json()

    def _post(self, path: str, payload: dict) -> dict:
        url = f"{self.base_url}{path}"
        try:
            response = self._session.post(url, json=payload)
        except requests.RequestException as exc:
            raise LNDError(f"POST {path} failed: {exc}") from exc
        if not response.ok:
            raise LNDError(f"POST {path} → HTTP {response.status_code}: {response.text}")
        return response.json()

    def create_invoice(
        self,
        amount_sats: int,
        memo: str,
        expiry: int = 3600,
    ) -> dict:
        """
        Create a BOLT-11 invoice.

        Returns the full LND response dict (includes ``payment_request``,
        ``r_hash``, ``add_index``).
        """
        payload = {
            "value": amount_sats,
            "memo": memo,
            "expiry": expiry,
        }
        return self._post("/v1/invoices", payload)

    def verify_payment(self, r_hash_hex: str) -> dict:
        """
        Look up an invoice by its r_hash (hex string).

        Returns a dict with keys:
            settled     (bool)
            amount_sats (int)
        """
        data = self._get(f"/v1/invoice/{r_hash_hex}")
        return {
            "settled": bool(data.get("settled", False)),
            "amount_sats": int(data.get("amt_paid_sat", 0)),
        }

    def subscribe_invoices(self, settle_index: int = 0) -> Iterator[dict]:
        """Stream settled invoices via LND's SubscribeInvoices REST endpoint.

        Yields dicts with keys: r_hash_hex, settled, amount_sats.
        Blocks until a new invoice event arrives. Caller should run in a thread.
        Reconnects are the caller's responsibility.
        """
        url = f"{self.base_url}/v1/invoices/subscribe"
        params = {}
        if settle_index > 0:
            params["settle_index"] = settle_index
        try:
            response = self._session.get(url, params=params, stream=True, timeout=None)
        except requests.RequestException as exc:
            raise LNDError(f"SubscribeInvoices connection failed: {exc}") from exc
        if not response.ok:
            raise LNDError(f"SubscribeInvoices → HTTP {response.status_code}: {response.text}")
        for line in response.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("Skipping non-JSON line from SubscribeInvoices: %s", line[:200])
                continue
            # LND wraps the invoice in a "result" key
            invoice = data.get("result", data)
            settled = invoice.get("settled", False) or invoice.get("state") == "SETTLED"
            if not settled:
                continue
            r_hash = invoice.get("r_hash", "")
            # r_hash may be base64 from REST — convert to hex
            if r_hash:
                import base64
                try:
                    r_hash_bytes = base64.b64decode(r_hash)
                    r_hash_hex = r_hash_bytes.hex()
                except Exception:
                    r_hash_hex = r_hash
            else:
                r_hash_hex = ""
            yield {
                "r_hash_hex": r_hash_hex,
                "settled": True,
                "amount_sats": int(invoice.get("amt_paid_sat", 0)),
                "settle_index": int(invoice.get("settle_index", 0)),
            }

    def get_channel_balance(self) -> dict:
        """
        Query channel balances.

        Returns a dict with keys:
            local_sats  (int)
            remote_sats (int)
        """
        data = self._get("/v1/balance/channels")
        return {
            "local_sats": int(data["local_balance"]["sat"]),
            "remote_sats": int(data["remote_balance"]["sat"]),
        }
