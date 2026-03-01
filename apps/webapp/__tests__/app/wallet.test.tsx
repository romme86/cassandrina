import React from "react";
import { render, screen } from "@testing-library/react";

// Inline component tests for wallet page logic — no LND dependency

interface LndBalance {
  onchainConfirmed: number;
  onchainUnconfirmed: number;
  channelLocal: number;
  channelRemote: number;
}

function WalletBalanceCards({ balance }: { balance: LndBalance }) {
  const totalLocal = balance.channelLocal;
  const totalCapacity = balance.channelLocal + balance.channelRemote;
  const liquidityPct = totalCapacity > 0 ? Math.round((totalLocal / totalCapacity) * 100) : 0;

  return (
    <div data-testid="wallet-cards">
      <div data-testid="onchain-balance">
        {balance.onchainConfirmed.toLocaleString()} sats
      </div>
      <div data-testid="unconfirmed-balance">
        {balance.onchainUnconfirmed.toLocaleString()} sats
      </div>
      <div data-testid="channel-local">
        {balance.channelLocal.toLocaleString()} sats
      </div>
      <div data-testid="channel-remote">
        {balance.channelRemote.toLocaleString()} sats
      </div>
      <div data-testid="liquidity-pct">{liquidityPct}%</div>
    </div>
  );
}

interface TxRow {
  id: string;
  type: "invoice" | "trade";
  description: string;
  amount_sats: number;
  settled: boolean;
  created_at: string;
}

function TransactionTable({ transactions }: { transactions: TxRow[] }) {
  return (
    <table data-testid="tx-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Description</th>
          <th>Amount</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {transactions.map((tx) => (
          <tr key={tx.id} data-testid={`tx-row-${tx.id}`}>
            <td>{tx.created_at}</td>
            <td data-testid={`tx-type-${tx.id}`}>{tx.type}</td>
            <td>{tx.description}</td>
            <td data-testid={`tx-amount-${tx.id}`}>
              {tx.amount_sats >= 0 ? "+" : ""}
              {tx.amount_sats.toLocaleString()}
            </td>
            <td data-testid={`tx-status-${tx.id}`}>
              {tx.settled ? "settled" : "pending"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const SAMPLE_BALANCE: LndBalance = {
  onchainConfirmed: 500000,
  onchainUnconfirmed: 0,
  channelLocal: 300000,
  channelRemote: 200000,
};

const SAMPLE_TXS: TxRow[] = [
  {
    id: "abc1",
    type: "invoice",
    description: "Prediction payment",
    amount_sats: 1000,
    settled: true,
    created_at: "2026-02-01",
  },
  {
    id: "abc2",
    type: "trade",
    description: "Strategy A long",
    amount_sats: -500,
    settled: false,
    created_at: "2026-02-02",
  },
];

describe("WalletBalanceCards", () => {
  it("renders on-chain confirmed balance", () => {
    render(<WalletBalanceCards balance={SAMPLE_BALANCE} />);
    expect(screen.getByTestId("onchain-balance")).toHaveTextContent("500,000 sats");
  });

  it("renders channel local balance", () => {
    render(<WalletBalanceCards balance={SAMPLE_BALANCE} />);
    expect(screen.getByTestId("channel-local")).toHaveTextContent("300,000 sats");
  });

  it("renders channel remote balance", () => {
    render(<WalletBalanceCards balance={SAMPLE_BALANCE} />);
    expect(screen.getByTestId("channel-remote")).toHaveTextContent("200,000 sats");
  });

  it("computes liquidity percentage correctly", () => {
    render(<WalletBalanceCards balance={SAMPLE_BALANCE} />);
    // 300000 / 500000 = 60%
    expect(screen.getByTestId("liquidity-pct")).toHaveTextContent("60%");
  });

  it("shows 0% liquidity when capacity is zero", () => {
    render(
      <WalletBalanceCards
        balance={{ onchainConfirmed: 0, onchainUnconfirmed: 0, channelLocal: 0, channelRemote: 0 }}
      />
    );
    expect(screen.getByTestId("liquidity-pct")).toHaveTextContent("0%");
  });
});

describe("TransactionTable", () => {
  it("renders all transaction rows", () => {
    render(<TransactionTable transactions={SAMPLE_TXS} />);
    expect(screen.getByTestId("tx-row-abc1")).toBeInTheDocument();
    expect(screen.getByTestId("tx-row-abc2")).toBeInTheDocument();
  });

  it("renders transaction types correctly", () => {
    render(<TransactionTable transactions={SAMPLE_TXS} />);
    expect(screen.getByTestId("tx-type-abc1")).toHaveTextContent("invoice");
    expect(screen.getByTestId("tx-type-abc2")).toHaveTextContent("trade");
  });

  it("renders positive amount with + prefix", () => {
    render(<TransactionTable transactions={SAMPLE_TXS} />);
    expect(screen.getByTestId("tx-amount-abc1")).toHaveTextContent("+1,000");
  });

  it("renders settled status", () => {
    render(<TransactionTable transactions={SAMPLE_TXS} />);
    expect(screen.getByTestId("tx-status-abc1")).toHaveTextContent("settled");
    expect(screen.getByTestId("tx-status-abc2")).toHaveTextContent("pending");
  });
});
