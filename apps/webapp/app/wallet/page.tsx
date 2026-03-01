"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Wallet, Zap, Bitcoin, ArrowDownLeft, ArrowUpRight } from "lucide-react";

interface LndBalance {
  onchainConfirmed: number;
  onchainUnconfirmed: number;
  channelLocal: number;
  channelRemote: number;
}

interface TxRow {
  id: string;
  type: "invoice" | "trade";
  description: string;
  amount_sats: number;
  settled: boolean;
  created_at: string;
}

function BalanceCard({
  label,
  value,
  subValue,
  icon: Icon,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="border-white/5">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
            <p className="text-2xl font-bold text-primary font-mono">{value}</p>
            {subValue && <p className="text-xs text-muted-foreground mt-1">{subValue}</p>}
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LiquidityBar({
  local,
  remote,
}: {
  local: number;
  remote: number;
}) {
  const total = local + remote;
  const localPct = total > 0 ? Math.round((local / total) * 100) : 0;
  const remotePct = 100 - localPct;

  return (
    <Card className="border-white/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-primary" />
          Lightning Liquidity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="h-3 rounded-full bg-secondary overflow-hidden flex">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${localPct}%` }}
            />
            <div
              className="h-full bg-secondary-foreground/10 transition-all"
              style={{ width: `${remotePct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              <span className="text-primary font-medium">{localPct}%</span> outbound (
              {local.toLocaleString()} sats)
            </span>
            <span>
              {remotePct}% inbound ({remote.toLocaleString()} sats)
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Total capacity: {total.toLocaleString()} sats
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WalletPage() {
  const [balance, setBalance] = useState<LndBalance | null>(null);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/wallet")
      .then((r) => r.json())
      .then((data) => {
        setBalance(data.balance ?? null);
        setTransactions(data.transactions ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Wallet className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Wallet</h1>
          <p className="text-sm text-muted-foreground">Lightning Node &amp; on-chain balance</p>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading wallet data...</p>
      ) : (
        <>
          {/* Balance cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <BalanceCard
              label="On-chain Balance"
              value={balance ? `${balance.onchainConfirmed.toLocaleString()}` : "—"}
              subValue="confirmed sats"
              icon={Bitcoin}
            />
            <BalanceCard
              label="Unconfirmed"
              value={balance ? `${balance.onchainUnconfirmed.toLocaleString()}` : "—"}
              subValue="pending sats"
              icon={ArrowDownLeft}
            />
            <BalanceCard
              label="Channel Outbound"
              value={balance ? `${balance.channelLocal.toLocaleString()}` : "—"}
              subValue="spendable sats"
              icon={ArrowUpRight}
            />
          </div>

          {/* Lightning liquidity bar */}
          {balance && (
            <LiquidityBar local={balance.channelLocal} remote={balance.channelRemote} />
          )}

          {/* Transaction activity */}
          <Card className="border-white/5">
            <CardHeader>
              <CardTitle className="text-base">Transaction Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {transactions.length === 0 ? (
                <p className="text-muted-foreground text-sm px-6 pb-6">No transactions yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/5 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Date</TableHead>
                      <TableHead className="text-muted-foreground">Type</TableHead>
                      <TableHead className="text-muted-foreground">Description</TableHead>
                      <TableHead className="text-right text-muted-foreground">Amount (sats)</TableHead>
                      <TableHead className="text-muted-foreground">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id} className="border-white/5 hover:bg-secondary/50">
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {new Date(tx.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              tx.type === "invoice"
                                ? "bg-primary/10 text-primary"
                                : "bg-blue-900/40 text-blue-400"
                            }`}
                          >
                            {tx.type}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {tx.description}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono text-sm ${
                            tx.amount_sats >= 0 ? "text-primary" : "text-red-400"
                          }`}
                        >
                          {tx.amount_sats >= 0 ? "+" : ""}
                          {tx.amount_sats.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {tx.settled ? (
                            <span className="text-xs text-primary">Settled</span>
                          ) : (
                            <span className="text-xs text-yellow-400">Pending</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
