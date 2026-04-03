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
import { withBasePath } from "@/lib/base-path";
import { formatScorePercent } from "@/lib/score-format";
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
    <Card>
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
      const res = await fetch(withBasePath(`/api/history?${params.toString()}`));
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
    <div className="space-y-8">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
          <History className="h-3.5 w-3.5" />
          Trade archive
        </div>
        <h1 className="text-4xl font-bold text-white">Trade &amp; Prediction History</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Historical log of executed trades and prediction outcomes.
        </p>
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
          value={stats ? formatScorePercent(stats.avg_confidence) : "—"}
          icon={Activity}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit border-white/5 bg-card/95">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Strategy</label>
              <Select
                value={strategy}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setStrategy(e.target.value)
                }
                className="w-full"
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
                className="w-full"
              >
                <option value="">All Outcomes</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="liquidated">Liquidated</option>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/5 bg-card/95">
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Loading...</p>
            ) : trades.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No trades found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-background/40 hover:bg-background/40">
                    <TableHead>Date/Time</TableHead>
                    <TableHead>Strategy</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead className="text-right">PnL (sats)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.map((t) => (
                    <TableRow key={t.id}>
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
                          ? formatScorePercent(t.confidence_score)
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
    </div>
  );
}
