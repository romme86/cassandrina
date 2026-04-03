import React from "react";
import { render, screen } from "@testing-library/react";

// Inline component tests for history page logic — no DB dependency

interface HistoryKpi {
  totalTrades: number;
  winRate: number;
  netProfitSats: number;
  avgConfidence: number;
}

function HistoryKpiBar({ kpi }: { kpi: HistoryKpi }) {
  return (
    <div data-testid="kpi-bar">
      <span data-testid="total-trades">{kpi.totalTrades} trades</span>
      <span data-testid="win-rate">{kpi.winRate.toFixed(1)}% win rate</span>
      <span data-testid="net-profit">
        {kpi.netProfitSats >= 0 ? "+" : ""}
        {kpi.netProfitSats.toLocaleString()} sats
      </span>
      <span data-testid="avg-confidence">{(kpi.avgConfidence * 100).toFixed(1)}% avg confidence</span>
    </div>
  );
}

interface TradeRow {
  id: number;
  opened_at: string;
  strategy: string;
  direction: string;
  confidence_score: number | null;
  status: string;
  pnl_sats: number | null;
}

function TradeTable({ trades }: { trades: TradeRow[] }) {
  return (
    <table data-testid="trade-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Strategy</th>
          <th>Direction</th>
          <th>Confidence</th>
          <th>Result</th>
          <th>PnL (sats)</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => (
          <tr key={t.id} data-testid={`trade-row-${t.id}`}>
            <td>{t.opened_at}</td>
            <td>{t.strategy}</td>
            <td>{t.direction}</td>
            <td>{t.confidence_score != null ? `${(t.confidence_score * 100).toFixed(1)}%` : "—"}</td>
            <td data-testid={`result-${t.id}`}>{t.status}</td>
            <td data-testid={`pnl-${t.id}`}>
              {t.pnl_sats != null
                ? `${t.pnl_sats >= 0 ? "+" : ""}${t.pnl_sats.toLocaleString()}`
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FilterControls({
  strategy,
  outcome,
  onStrategyChange,
  onOutcomeChange,
}: {
  strategy: string;
  outcome: string;
  onStrategyChange: (v: string) => void;
  onOutcomeChange: (v: string) => void;
}) {
  return (
    <div data-testid="filter-controls">
      <select
        data-testid="strategy-filter"
        value={strategy}
        onChange={(e) => onStrategyChange(e.target.value)}
      >
        <option value="">All Strategies</option>
        <option value="A">Strategy A</option>
        <option value="B">Strategy B</option>
      </select>
      <select
        data-testid="outcome-filter"
        value={outcome}
        onChange={(e) => onOutcomeChange(e.target.value)}
      >
        <option value="">All Outcomes</option>
        <option value="closed">Won</option>
        <option value="liquidated">Liquidated</option>
      </select>
    </div>
  );
}

const SAMPLE_TRADES: TradeRow[] = [
  {
    id: 1,
    opened_at: "2026-02-01",
    strategy: "A",
    direction: "long",
    confidence_score: 0.725,
    status: "closed",
    pnl_sats: 1500,
  },
  {
    id: 2,
    opened_at: "2026-02-02",
    strategy: "B",
    direction: "short",
    confidence_score: 0.58,
    status: "liquidated",
    pnl_sats: -800,
  },
  {
    id: 3,
    opened_at: "2026-02-03",
    strategy: "A",
    direction: "long",
    confidence_score: null,
    status: "open",
    pnl_sats: null,
  },
];

describe("HistoryKpiBar", () => {
  it("renders total trades count", () => {
    render(
      <HistoryKpiBar
        kpi={{ totalTrades: 42, winRate: 65.3, netProfitSats: 12000, avgConfidence: 0.685 }}
      />
    );
    expect(screen.getByTestId("total-trades")).toHaveTextContent("42 trades");
  });

  it("renders win rate", () => {
    render(
      <HistoryKpiBar
        kpi={{ totalTrades: 10, winRate: 70.0, netProfitSats: 5000, avgConfidence: 0.72 }}
      />
    );
    expect(screen.getByTestId("win-rate")).toHaveTextContent("70.0% win rate");
  });

  it("renders net profit with + sign for positive", () => {
    render(
      <HistoryKpiBar
        kpi={{ totalTrades: 5, winRate: 60.0, netProfitSats: 3000, avgConfidence: 0.65 }}
      />
    );
    expect(screen.getByTestId("net-profit")).toHaveTextContent("+3,000 sats");
  });

  it("renders avg confidence", () => {
    render(
      <HistoryKpiBar
        kpi={{ totalTrades: 5, winRate: 60.0, netProfitSats: 100, avgConfidence: 0.682 }}
      />
    );
    expect(screen.getByTestId("avg-confidence")).toHaveTextContent("68.2% avg confidence");
  });
});

describe("TradeTable", () => {
  it("renders trade rows with strategy and direction", () => {
    render(<TradeTable trades={SAMPLE_TRADES} />);
    expect(screen.getByTestId("trade-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("trade-row-2")).toBeInTheDocument();
  });

  it("renders PnL values correctly", () => {
    render(<TradeTable trades={SAMPLE_TRADES} />);
    expect(screen.getByTestId("pnl-1")).toHaveTextContent("+1,500");
    expect(screen.getByTestId("pnl-2")).toHaveTextContent("-800");
    expect(screen.getByTestId("pnl-3")).toHaveTextContent("—");
  });

  it("renders status/result column", () => {
    render(<TradeTable trades={SAMPLE_TRADES} />);
    expect(screen.getByTestId("result-1")).toHaveTextContent("closed");
    expect(screen.getByTestId("result-2")).toHaveTextContent("liquidated");
  });
});

describe("FilterControls", () => {
  it("renders strategy filter dropdown", () => {
    render(
      <FilterControls
        strategy=""
        outcome=""
        onStrategyChange={() => {}}
        onOutcomeChange={() => {}}
      />
    );
    expect(screen.getByTestId("strategy-filter")).toBeInTheDocument();
  });

  it("renders outcome filter dropdown", () => {
    render(
      <FilterControls
        strategy=""
        outcome=""
        onStrategyChange={() => {}}
        onOutcomeChange={() => {}}
      />
    );
    expect(screen.getByTestId("outcome-filter")).toBeInTheDocument();
  });
});
