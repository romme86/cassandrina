import { Coins, TrendingUp, Activity, Zap } from "lucide-react";
import { query } from "@/lib/db";
import type { Trade, PredictionRound } from "@cassandrina/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatCard } from "@/components/stat-card";
import { StrategyBadge } from "@/components/strategy-badge";
import { PnlChart } from "@/components/pnl-chart";
import { StrategyChart } from "@/components/strategy-chart";
import { AutoRefresh } from "@/components/auto-refresh";

export const revalidate = 30;

async function getOpenTrades(): Promise<Trade[]> {
  try {
    return await query<Trade>(
      "SELECT * FROM trades WHERE status = 'open' ORDER BY opened_at DESC"
    );
  } catch {
    return [];
  }
}

async function getCurrentRound(): Promise<PredictionRound | null> {
  try {
    const rows = await query<PredictionRound>(
      "SELECT * FROM prediction_rounds WHERE status = 'open' ORDER BY question_date DESC LIMIT 1"
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function getTotalSats(): Promise<number> {
  try {
    const rows = await query<{ total: number }>(
      "SELECT COALESCE(SUM(delta_sats), 0)::int AS total FROM balance_entries"
    );
    return rows[0]?.total ?? 0;
  } catch {
    return 0;
  }
}

async function getTodayPnl(): Promise<number> {
  try {
    const rows = await query<{ total: number }>(
      `SELECT COALESCE(SUM(pnl_sats), 0)::int AS total FROM trades
       WHERE status IN ('closed','liquidated') AND DATE(closed_at) = CURRENT_DATE`
    );
    return rows[0]?.total ?? 0;
  } catch {
    return 0;
  }
}

async function getPnlData() {
  try {
    return await query<{ day: string; daily_pnl: number; cumulative_pnl: number }>(
      `SELECT DATE(opened_at) AS day,
              SUM(pnl_sats)::int AS daily_pnl,
              SUM(SUM(pnl_sats)) OVER (ORDER BY DATE(opened_at))::int AS cumulative_pnl
       FROM trades
       WHERE status IN ('closed','liquidated')
         AND opened_at > NOW() - INTERVAL '30 days'
       GROUP BY day ORDER BY day`
    );
  } catch {
    return [];
  }
}

async function getStrategyData() {
  try {
    return await query<{
      strategy: string;
      total_trades: number;
      wins: number;
      avg_pnl_sats: number;
      total_pnl_sats: number;
    }>(
      `SELECT strategy, COUNT(*)::int AS total_trades,
              SUM(CASE WHEN pnl_sats > 0 THEN 1 ELSE 0 END)::int AS wins,
              ROUND(AVG(pnl_sats))::int AS avg_pnl_sats,
              SUM(pnl_sats)::int AS total_pnl_sats
       FROM trades WHERE status IN ('closed','liquidated')
       GROUP BY strategy ORDER BY strategy`
    );
  } catch {
    return [];
  }
}

function timeInTrade(openedAt: string): string {
  const ms = Date.now() - new Date(openedAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function DashboardPage() {
  const [trades, round, totalSats, todayPnl, pnlData, strategyData] =
    await Promise.all([
      getOpenTrades(),
      getCurrentRound(),
      getTotalSats(),
      getTodayPnl(),
      getPnlData(),
      getStrategyData(),
    ]);

  return (
    <div className="space-y-6">
      <AutoRefresh />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Portfolio (sats)"
          value={totalSats.toLocaleString()}
          icon={Coins}
        />
        <StatCard
          label="Today P&L"
          value={`${todayPnl >= 0 ? "+" : ""}${todayPnl.toLocaleString()} sats`}
          icon={TrendingUp}
          delta={todayPnl}
          deltaLabel={`${todayPnl >= 0 ? "+" : ""}${todayPnl} sats`}
        />
        <StatCard
          label="Confidence"
          value={
            round?.confidence_score != null
              ? `${round.confidence_score.toFixed(1)}%`
              : "—"
          }
          icon={Activity}
        />
        <StatCard
          label="Active Strategy"
          value={round?.strategy_used ? `Strategy ${round.strategy_used}` : "—"}
          icon={Zap}
        />
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              P&amp;L — 30-day window
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PnlChart data={pnlData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Strategy Win Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StrategyChart data={strategyData} />
          </CardContent>
        </Card>
      </div>

      {/* Open positions table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Open Positions
            <span className="text-sm font-normal text-muted-foreground">
              ({trades.length} active)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {trades.length === 0 ? (
            <p className="text-muted-foreground text-sm px-6 pb-6">No open positions</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Leverage</TableHead>
                  <TableHead className="text-right">Sats</TableHead>
                  <TableHead className="text-right">P&amp;L</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((t: Trade) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <StrategyBadge strategy={t.strategy} />
                    </TableCell>
                    <TableCell
                      className={
                        t.direction === "long" ? "text-green-400" : "text-red-400"
                      }
                    >
                      {t.direction.toUpperCase()}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${t.entry_price.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${t.target_price.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">{t.leverage}x</TableCell>
                    <TableCell className="text-right font-mono">
                      {t.sats_deployed.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        (t.pnl_sats ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {t.pnl_sats != null
                        ? `${t.pnl_sats >= 0 ? "+" : ""}${t.pnl_sats}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs">
                      {timeInTrade(t.opened_at)}
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
