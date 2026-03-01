"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Select } from "@/components/ui/select";
import { StrategyBadge } from "@/components/strategy-badge";
import { History, TrendingUp, TrendingDown, Activity, BarChart2 } from "lucide-react";

interface TradeHistoryRow {
  id: number;
  opened_at: string;
  closed_at: string | null;
  strategy: string;
  direction: string;
  entry_price: number;
  target_price: number;
  leverage: number;
  sats_deployed: number;
  pnl_sats: number | null;
  status: string;
  confidence_score: number | null;
}

interface HistoryStats {
  total_trades: number;
  wins: number;
  net_pnl: number;
  avg_confidence: number;
}

function KpiTile({
  label,
  value,
  icon: Icon,
  positive,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  positive?: boolean;
}) {
  return (
    <Card className="border-white/5">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
            <p
              className={`text-xl font-bold ${
                positive === undefined
                  ? "text-white"
                  : positive
                  ? "text-primary"
                  : "text-red-400"
              }`}
            >
              {value}
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ResultBadge({ status, pnl }: { status: string; pnl: number | null }) {
  if (status === "open") {
    return <span className="text-xs text-yellow-400 font-medium">Open</span>;
  }
  if (status === "liquidated") {
    return <span className="text-xs text-red-400 font-medium">Liquidated</span>;
  }
  if (pnl != null && pnl > 0) {
    return <span className="text-xs text-primary font-medium">Won</span>;
  }
  return <span className="text-xs text-red-400 font-medium">Lost</span>;
}

export default function HistoryPage() {
  const [trades, setTrades] = useState<TradeHistoryRow[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [strategy, setStrategy] = useState("");
  const [outcome, setOutcome] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (strategy) params.set("strategy", strategy);
    if (outcome) params.set("outcome", outcome);
    try {
      const res = await fetch(`/api/history?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTrades(data.trades ?? []);
        setStats(data.stats ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [strategy, outcome]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const winRate =
    stats && stats.total_trades > 0
      ? ((stats.wins / stats.total_trades) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <History className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Trade History</h1>
          <p className="text-sm text-muted-foreground">All closed and open positions</p>
        </div>
      </div>

      {/* KPI stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiTile
          label="Total Trades"
          value={stats ? stats.total_trades.toLocaleString() : "—"}
          icon={BarChart2}
        />
        <KpiTile
          label="Win Rate"
          value={stats ? `${winRate}%` : "—"}
          positive={stats ? stats.wins / Math.max(stats.total_trades, 1) >= 0.5 : undefined}
          icon={TrendingUp}
        />
        <KpiTile
          label="Net Profit"
          value={
            stats
              ? `${stats.net_pnl >= 0 ? "+" : ""}${stats.net_pnl.toLocaleString()} sats`
              : "—"
          }
          positive={stats ? stats.net_pnl >= 0 : undefined}
          icon={stats && stats.net_pnl >= 0 ? TrendingUp : TrendingDown}
        />
        <KpiTile
          label="Avg Confidence"
          value={stats ? `${stats.avg_confidence.toFixed(1)}%` : "—"}
          icon={Activity}
        />
      </div>

      {/* Filters */}
      <Card className="border-white/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Strategy</label>
              <Select
                value={strategy}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setStrategy(e.target.value)
                }
                className="bg-secondary border-white/10 w-40"
              >
                <option value="">All Strategies</option>
                {["A", "B", "C", "D", "E"].map((s) => (
                  <option key={s} value={s}>
                    Strategy {s}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Outcome</label>
              <Select
                value={outcome}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setOutcome(e.target.value)
                }
                className="bg-secondary border-white/10 w-40"
              >
                <option value="">All Outcomes</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="liquidated">Liquidated</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trade table */}
      <Card className="border-white/5">
        <CardContent className="p-0">
          {loading ? (
            <p className="text-muted-foreground text-sm p-6">Loading...</p>
          ) : trades.length === 0 ? (
            <p className="text-muted-foreground text-sm p-6">No trades found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Date/Time</TableHead>
                  <TableHead className="text-muted-foreground">Strategy</TableHead>
                  <TableHead className="text-muted-foreground">Direction</TableHead>
                  <TableHead className="text-right text-muted-foreground">Confidence</TableHead>
                  <TableHead className="text-muted-foreground">Result</TableHead>
                  <TableHead className="text-right text-muted-foreground">PnL (sats)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((t) => (
                  <TableRow key={t.id} className="border-white/5 hover:bg-secondary/50">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {new Date(t.opened_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <StrategyBadge strategy={t.strategy} />
                    </TableCell>
                    <TableCell
                      className={`font-medium text-sm ${
                        t.direction === "long" ? "text-primary" : "text-red-400"
                      }`}
                    >
                      {t.direction.toUpperCase()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {t.confidence_score != null
                        ? `${t.confidence_score.toFixed(1)}%`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <ResultBadge status={t.status} pnl={t.pnl_sats} />
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-sm ${
                        t.pnl_sats == null
                          ? "text-muted-foreground"
                          : t.pnl_sats >= 0
                          ? "text-primary"
                          : "text-red-400"
                      }`}
                    >
                      {t.pnl_sats != null
                        ? `${t.pnl_sats >= 0 ? "+" : ""}${t.pnl_sats.toLocaleString()}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
