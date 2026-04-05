from __future__ import annotations

import argparse
import importlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cassandrina.hyperliquid_client import HyperliquidClient
from cassandrina.exchange import ExchangeError

_DEFAULT_STATE_DIR = Path.home() / ".cassandrina"
_DEFAULT_STATE_PATH = _DEFAULT_STATE_DIR / "hyperliquid-bootstrap.json"
_DEFAULT_ENV_PATH = _DEFAULT_STATE_DIR / "hyperliquid.env"
_USDC_DECIMALS = 6
_ERC20_ABI = [
    {
        "constant": False,
        "inputs": [{"name": "_to", "type": "address"}, {"name": "_value", "type": "uint256"}],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function",
    },
]


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_module(name: str):
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as exc:
        raise RuntimeError(f"Missing required dependency: {name}") from exc


@dataclass(slots=True)
class HyperliquidBootstrapState:
    state: str = "disabled"
    ready: bool = False
    created_at: str | None = None
    updated_at: str | None = None
    master_address: str = ""
    agent_address: str = ""
    agent_name: str = "cassandrina"
    env_file: str = ""
    funding_tx_hash: str = ""
    bridge_tx_hash: str = ""
    last_error: str = ""
    account_value_usdc: float = 0.0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "HyperliquidBootstrapState":
        defaults = cls()
        return cls(
            **{
                key: data.get(key, getattr(defaults, key))
                for key in cls.__dataclass_fields__
            }
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "ready": self.ready,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "master_address": self.master_address,
            "agent_address": self.agent_address,
            "agent_name": self.agent_name,
            "env_file": self.env_file,
            "funding_tx_hash": self.funding_tx_hash,
            "bridge_tx_hash": self.bridge_tx_hash,
            "last_error": self.last_error,
            "account_value_usdc": self.account_value_usdc,
        }


class HyperliquidBootstrapManager:
    def __init__(
        self,
        *,
        state_path: str | None = None,
        env_path: str | None = None,
        api_url: str | None = None,
        bridge_address: str | None = None,
        arbitrum_rpc_url: str | None = None,
        usdc_token_address: str | None = None,
    ):
        self._state_path = Path(state_path or os.environ.get("HYPERLIQUID_BOOTSTRAP_STATE_PATH") or _DEFAULT_STATE_PATH)
        self._env_path = Path(env_path or os.environ.get("HYPERLIQUID_BOOTSTRAP_ENV_PATH") or _DEFAULT_ENV_PATH)
        self._api_url = api_url or os.environ.get("HYPERLIQUID_API_URL")
        self._bridge_address = bridge_address or os.environ.get("HYPERLIQUID_BRIDGE_ADDRESS", "")
        self._arbitrum_rpc_url = arbitrum_rpc_url or os.environ.get("ARBITRUM_RPC_URL", "")
        self._usdc_token_address = usdc_token_address or os.environ.get("ARBITRUM_USDC_TOKEN_ADDRESS", "")
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._env_path.parent.mkdir(parents=True, exist_ok=True)

    def load_state(self) -> HyperliquidBootstrapState:
        if not self._state_path.exists():
            return HyperliquidBootstrapState()
        data = json.loads(self._state_path.read_text())
        return HyperliquidBootstrapState.from_dict(data)

    def save_state(self, state: HyperliquidBootstrapState) -> HyperliquidBootstrapState:
        state.updated_at = _utcnow()
        self._state_path.write_text(json.dumps(state.to_dict(), indent=2, sort_keys=True))
        return state

    def init_bootstrap(self) -> HyperliquidBootstrapState:
        eth_account = _require_module("eth_account")
        master = eth_account.Account.create()
        agent = eth_account.Account.create()
        state = HyperliquidBootstrapState(
            state="awaiting_funds",
            ready=False,
            created_at=_utcnow(),
            updated_at=_utcnow(),
            master_address=master.address,
            agent_address=agent.address,
            env_file=str(self._env_path),
        )
        self._write_env_file(
            {
                "EXCHANGE_PLATFORM": "hyperliquid",
                "HYPERLIQUID_ENABLED": "true",
                "HYPERLIQUID_UNSAFE_BOOTSTRAP": "true",
                "HYPERLIQUID_MAINNET": "true",
                "HYPERLIQUID_API_URL": self._api_url or "https://api.hyperliquid.xyz",
                "HYPERLIQUID_MASTER_ADDRESS": master.address,
                "HYPERLIQUID_MASTER_PRIVATE_KEY": master.key.hex(),
                "HYPERLIQUID_AGENT_ADDRESS": agent.address,
                "HYPERLIQUID_AGENT_PRIVATE_KEY": agent.key.hex(),
                "HYPERLIQUID_BRIDGE_ADDRESS": self._bridge_address,
                "ARBITRUM_RPC_URL": self._arbitrum_rpc_url,
                "ARBITRUM_USDC_TOKEN_ADDRESS": self._usdc_token_address,
            }
        )
        return self.save_state(state)

    def status(self) -> dict[str, Any]:
        state = self.load_state()
        status = state.to_dict()
        status["state_path"] = str(self._state_path)
        status["env_file"] = str(self._env_path)
        status["master_balances"] = self._onchain_balances(state.master_address) if state.master_address else {}
        if state.master_address and os.environ.get("HYPERLIQUID_MASTER_ADDRESS", state.master_address):
            try:
                self._sync_env_from_file()
                client = self._client_from_env()
                user_state = client.user_state()
                status["hyperliquid_state"] = {
                    "account_value": user_state.get("marginSummary", {}).get("accountValue"),
                    "withdrawable": user_state.get("withdrawable"),
                }
            except Exception as exc:
                status["hyperliquid_state_error"] = str(exc)
        return status

    def rotate_agent(self) -> HyperliquidBootstrapState:
        eth_account = _require_module("eth_account")
        state = self.load_state()
        if not state.master_address:
            raise RuntimeError("Bootstrap has not been initialized")
        agent = eth_account.Account.create()
        state.agent_address = agent.address
        state.ready = False
        state.state = "approving_agent"
        self._update_env_file(
            {
                "HYPERLIQUID_AGENT_ADDRESS": agent.address,
                "HYPERLIQUID_AGENT_PRIVATE_KEY": agent.key.hex(),
            }
        )
        self._sync_env_from_file()
        client = self._client_from_env()
        client.approve_agent(agent_address=agent.address, agent_name=state.agent_name)
        if client.is_ready():
            state.state = "ready"
            state.ready = True
        return self.save_state(state)

    def disable(self) -> HyperliquidBootstrapState:
        state = self.load_state()
        state.state = "disabled"
        state.ready = False
        return self.save_state(state)

    def advance(self) -> HyperliquidBootstrapState:
        state = self.load_state()
        if state.state in {"disabled", "ready"}:
            return state
        try:
            balances = self._onchain_balances(state.master_address)
            usdc_balance = balances.get("usdc", 0.0)
            eth_balance = balances.get("eth", 0.0)
            if state.state == "awaiting_funds":
                if usdc_balance <= 0 or eth_balance <= 0:
                    return self.save_state(state)
                state.state = "bridging"
                self.save_state(state)
            if state.state == "bridging":
                tx_hash = self._bridge_usdc_from_master()
                state.bridge_tx_hash = tx_hash
                state.state = "approving_agent"
                self.save_state(state)
            if state.state == "approving_agent":
                self._sync_env_from_file()
                client = self._client_from_env()
                client.approve_agent(agent_address=state.agent_address, agent_name=state.agent_name)
                user_state = client.user_state()
                account_value = float(user_state.get("marginSummary", {}).get("accountValue", 0.0) or 0.0)
                state.account_value_usdc = account_value
                state.ready = account_value > 0
                state.state = "ready" if state.ready else "awaiting_credit"
                return self.save_state(state)
            if state.state == "awaiting_credit":
                self._sync_env_from_file()
                client = self._client_from_env()
                user_state = client.user_state()
                account_value = float(user_state.get("marginSummary", {}).get("accountValue", 0.0) or 0.0)
                state.account_value_usdc = account_value
                if account_value > 0:
                    state.ready = True
                    state.state = "ready"
                return self.save_state(state)
        except Exception as exc:
            state.state = "error"
            state.last_error = str(exc)
            return self.save_state(state)
        return self.save_state(state)

    def _client_from_env(self) -> HyperliquidClient:
        return HyperliquidClient(
            api_url=os.environ.get("HYPERLIQUID_API_URL", self._api_url),
            account_address=os.environ.get("HYPERLIQUID_MASTER_ADDRESS"),
            agent_private_key=os.environ.get("HYPERLIQUID_AGENT_PRIVATE_KEY"),
        )

    def _sync_env_from_file(self) -> None:
        if not self._env_path.exists():
            return
        for line in self._env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ[key] = value

    def _write_env_file(self, values: dict[str, str]) -> None:
        lines = [f"{key}={value}" for key, value in values.items()]
        self._env_path.write_text("\n".join(lines) + "\n")

    def _update_env_file(self, updates: dict[str, str]) -> None:
        existing: dict[str, str] = {}
        if self._env_path.exists():
            for line in self._env_path.read_text().splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    key, value = line.split("=", 1)
                    existing[key] = value
        existing.update(updates)
        self._write_env_file(existing)

    def _onchain_balances(self, address: str) -> dict[str, float]:
        if not address or not self._arbitrum_rpc_url or not self._usdc_token_address:
            return {"eth": 0.0, "usdc": 0.0}
        web3_mod = _require_module("web3")
        w3 = web3_mod.Web3(web3_mod.Web3.HTTPProvider(self._arbitrum_rpc_url))
        checksum_address = w3.to_checksum_address(address)
        usdc = w3.eth.contract(address=w3.to_checksum_address(self._usdc_token_address), abi=_ERC20_ABI)
        wei_balance = w3.eth.get_balance(checksum_address)
        token_balance = usdc.functions.balanceOf(checksum_address).call()
        return {
            "eth": float(w3.from_wei(wei_balance, "ether")),
            "usdc": token_balance / (10 ** _USDC_DECIMALS),
        }

    def _bridge_usdc_from_master(self) -> str:
        if not self._bridge_address:
            raise RuntimeError("HYPERLIQUID_BRIDGE_ADDRESS is required")
        if not self._arbitrum_rpc_url or not self._usdc_token_address:
            raise RuntimeError("ARBITRUM_RPC_URL and ARBITRUM_USDC_TOKEN_ADDRESS are required")
        eth_account = _require_module("eth_account")
        web3_mod = _require_module("web3")
        master_key = os.environ.get("HYPERLIQUID_MASTER_PRIVATE_KEY")
        master_address = os.environ.get("HYPERLIQUID_MASTER_ADDRESS")
        if not master_key or not master_address:
            raise RuntimeError("Master wallet env vars are not loaded")
        w3 = web3_mod.Web3(web3_mod.Web3.HTTPProvider(self._arbitrum_rpc_url))
        checksum_master = w3.to_checksum_address(master_address)
        usdc = w3.eth.contract(address=w3.to_checksum_address(self._usdc_token_address), abi=_ERC20_ABI)
        raw_balance = int(usdc.functions.balanceOf(checksum_master).call())
        if raw_balance <= 0:
            raise RuntimeError("No USDC balance available to bridge")
        nonce = w3.eth.get_transaction_count(checksum_master)
        gas_price = w3.eth.gas_price
        transfer = usdc.functions.transfer(
            w3.to_checksum_address(self._bridge_address),
            raw_balance,
        )
        gas = transfer.estimate_gas({"from": checksum_master})
        built_tx = transfer.build_transaction(
            {
                "chainId": int(w3.eth.chain_id),
                "from": checksum_master,
                "nonce": nonce,
                "gas": gas,
                "gasPrice": gas_price,
            }
        )
        signed = eth_account.Account.sign_transaction(built_tx, master_key)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
        if int(receipt.status) != 1:
            raise RuntimeError("USDC bridge transfer failed")
        return receipt.transactionHash.hex()


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage Cassandrina Hyperliquid bootstrap state")
    parser.add_argument("command", choices=["init", "status", "rotate-agent", "disable", "advance"])
    args = parser.parse_args()

    manager = HyperliquidBootstrapManager()

    if args.command == "init":
        state = manager.init_bootstrap()
        print(json.dumps(
            {
                "state": state.to_dict(),
                "fund_master_wallet_on_arbitrum": state.master_address,
                "env_file": state.env_file,
            },
            indent=2,
        ))
        return
    if args.command == "status":
        print(json.dumps(manager.status(), indent=2))
        return
    if args.command == "rotate-agent":
        print(json.dumps(manager.rotate_agent().to_dict(), indent=2))
        return
    if args.command == "disable":
        print(json.dumps(manager.disable().to_dict(), indent=2))
        return
    print(json.dumps(manager.advance().to_dict(), indent=2))


if __name__ == "__main__":
    main()
