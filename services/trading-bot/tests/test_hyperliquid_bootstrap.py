import json
from pathlib import Path

from cassandrina.hyperliquid_bootstrap import HyperliquidBootstrapManager, HyperliquidBootstrapState


def test_state_round_trip(tmp_path: Path):
    manager = HyperliquidBootstrapManager(
        state_path=str(tmp_path / "state.json"),
        env_path=str(tmp_path / "hyperliquid.env"),
    )
    state = HyperliquidBootstrapState(
        state="awaiting_funds",
        master_address="0xmaster",
        agent_address="0xagent",
        env_file=str(tmp_path / "hyperliquid.env"),
    )

    manager.save_state(state)
    loaded = manager.load_state()

    assert loaded.state == "awaiting_funds"
    assert loaded.master_address == "0xmaster"
    assert loaded.agent_address == "0xagent"


def test_disable_marks_bootstrap_not_ready(tmp_path: Path):
    manager = HyperliquidBootstrapManager(
        state_path=str(tmp_path / "state.json"),
        env_path=str(tmp_path / "hyperliquid.env"),
    )
    manager.save_state(
        HyperliquidBootstrapState(
            state="ready",
            ready=True,
            master_address="0xmaster",
            agent_address="0xagent",
        )
    )

    state = manager.disable()

    assert state.state == "disabled"
    assert state.ready is False
    persisted = json.loads((tmp_path / "state.json").read_text())
    assert persisted["state"] == "disabled"
