import { Coins, TrendingUp, Activity, Zap, Clock, ArrowUpRight } from "lucide-react";
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
import { StrategyBadge } from "@/components/strategy-badge";
import { PnlChart } from "@/components/pnl-chart";
import { StrategyChart } from "@/components/strategy-chart";
import { AutoRefresh } from "@/components/auto-refresh";
import { BotLifecycleBadge } from "@/components/bot-lifecycle-badge";
import { deriveBotControlStatus } from "@/lib/bot-control";
import { formatScorePercent } from "@/lib/score-format";

export const dynamic = "force-dynamic";

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
      `SELECT * FROM prediction_rounds
       WHERE status IN ('open', 'closed')
       ORDER BY open_at DESC, id DESC LIMIT 1`
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

async function getBotStatus() {
  try {
    const rows = await query<{ key: string; value: string }>(
      "SELECT key, value FROM bot_config"
    );
    return deriveBotControlStatus(Object.fromEntries(rows.map((row) => [row.key, row.value])));
  } catch {
    return deriveBotControlStatus({});
  }
}

function timeInTrade(openedAt: string): string {
  const ms = Date.now() - new Date(openedAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function KpiCard({
  label,
  value,
  subValue,
  positive,
  icon: Icon,
}: {
  label: string;
  value: string;
  subValue?: string;
  positive?: boolean;
  icon: React.ElementType;
}) {
  return (
    <Card className="group relative overflow-hidden border-white/5 bg-card/95 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30">
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-primary/10 blur-3xl" />
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="text-2xl font-bold text-white">{value}</p>
            {subValue && (
              <p
                className={`text-xs mt-1 font-medium ${
                  positive === undefined
                    ? "text-muted-foreground"
                    : positive
                    ? "text-primary"
                    : "text-red-400"
                }`}
              >
                {subValue}
              </p>
            )}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary ring-1 ring-white/5">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const [trades, round, totalSats, todayPnl, pnlData, strategyData, botStatus] =
    await Promise.all([
      getOpenTrades(),
      getCurrentRound(),
      getTotalSats(),
      getTodayPnl(),
      getPnlData(),
      getStrategyData(),
      getBotStatus(),
    ]);

  return (
    <div className="space-y-8">
      <AutoRefresh />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Market Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live data from Telegram consensus and execution activity.
          </p>
        </div>
        <BotLifecycleBadge state={botStatus.actualState} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pool Value"
          value={`${totalSats.toLocaleString()} sats`}
          subValue="Total accumulated"
          icon={Coins}
        />
        <KpiCard
          label="Today P&L"
          value={`${todayPnl >= 0 ? "+" : ""}${todayPnl.toLocaleString()}`}
          subValue="sats today"
          positive={todayPnl >= 0}
          icon={TrendingUp}
        />
        <KpiCard
          label="Confidence"
          value={
            round?.confidence_score != null
              ? formatScorePercent(round.confidence_score)
              : "—"
          }
          subValue={round ? "current round" : "no active round"}
          icon={Activity}
        />
        <KpiCard
          label="Active Strategy"
          value={round?.strategy_used ? `Strategy ${round.strategy_used}` : "—"}
          subValue={round?.strategy_used ? "executing" : "waiting"}
          icon={Zap}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-white/5 bg-card/95">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base text-white">
                  <ArrowUpRight className="h-4 w-4 text-primary" />
                  BTC / USDT Position View
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  P&amp;L over the last 30 days
                </p>
              </div>
              <div className="flex gap-2">
                <span className="rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground">
                  1H
                </span>
                <span className="rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/30">
                  4H
                </span>
                <span className="rounded-lg bg-secondary px-3 py-1.5 text-xs text-muted-foreground">
                  1D
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <PnlChart data={pnlData} />
          </CardContent>
        </Card>

        <Card className="border-white/5 bg-card/95">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <Activity className="h-4 w-4 text-primary" />
              Strategy Win Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StrategyChart data={strategyData} />
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/5 bg-card/95">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Clock className="h-4 w-4 text-primary" />
            Open Positions
            <span className="text-sm font-normal text-muted-foreground">
              ({trades.length} active)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {trades.length === 0 ? (
            <p className="text-muted-foreground text-sm px-6 pb-6">
              No open positions
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-background/40 hover:bg-background/40">
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
                  <TableRow key={t.id} className="border-border/30 hover:bg-secondary/50">
                    <TableCell>
                      <StrategyBadge strategy={t.strategy} />
                    </TableCell>
                    <TableCell
                      className={
                        t.direction === "long" ? "text-primary font-medium" : "text-red-400 font-medium"
                      }
                    >
                      {t.direction.toUpperCase()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${t.entry_price.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${t.target_price.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {t.leverage}x
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {t.sats_deployed.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-sm ${
                        (t.pnl_sats ?? 0) >= 0 ? "text-primary" : "text-red-400"
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
