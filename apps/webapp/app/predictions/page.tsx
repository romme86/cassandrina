import Link from "next/link";
import { query } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";
import { StrategyBadge } from "@/components/strategy-badge";
import { formatScorePercent } from "@/lib/score-format";
import { AutoRefresh } from "@/components/auto-refresh";
import { withBasePath } from "@/lib/base-path";
import { LineChart } from "lucide-react";

export const dynamic = "force-dynamic";

interface RoundWithMeta {
  id: number;
  question_date: string;
  target_hour: number;
  open_at: string;
  close_at: string | null;
  polymarket_probability: number | null;
  status: string;
  btc_target_price: number | null;
  btc_actual_price: number | null;
  confidence_score: number | null;
  strategy_used: string | null;
  participant_count: number;
  winner_name: string | null;
}

interface StrategyRow {
  strategy: string;
  total_trades: number;
  wins: number;
  avg_pnl_sats: number;
  total_pnl_sats: number;
}

async function getRounds(): Promise<RoundWithMeta[]> {
  try {
    return await query<RoundWithMeta>(
      `SELECT r.*,
              COUNT(DISTINCT p.id)::int AS participant_count,
              (SELECT u.display_name
               FROM predictions p2
               JOIN users u ON u.id = p2.user_id
               WHERE p2.round_id = r.id AND r.btc_actual_price IS NOT NULL
               ORDER BY ABS(p2.predicted_price - r.btc_actual_price) ASC
               LIMIT 1) AS winner_name
       FROM prediction_rounds r
       LEFT JOIN predictions p ON p.round_id = r.id
       GROUP BY r.id
       ORDER BY r.open_at DESC, r.id DESC
       LIMIT 50`
    );
  } catch {
    return [];
  }
}

async function getStrategyStats(): Promise<StrategyRow[]> {
  try {
    return await query<StrategyRow>(
      `SELECT strategy,
              COUNT(*)::int AS total_trades,
              SUM(CASE WHEN pnl_sats > 0 THEN 1 ELSE 0 END)::int AS wins,
              COALESCE(ROUND(AVG(pnl_sats)), 0)::int AS avg_pnl_sats,
              COALESCE(SUM(pnl_sats), 0)::int AS total_pnl_sats
       FROM trades WHERE status IN ('closed','liquidated')
       GROUP BY strategy ORDER BY strategy`
    );
  } catch {
    return [];
  }
}

function RoundsTable({ rounds }: { rounds: RoundWithMeta[] }) {
  if (rounds.length === 0) {
    return (
      <tr>
        <td colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
          No rounds yet
        </td>
      </tr>
    );
  }
  return (
    <>
      {rounds.map((r) => (
        <TableRow
          key={r.id}
          className="cursor-pointer hover:bg-secondary/50 border-border/30"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.location.href = withBasePath(`/predictions/${r.id}`);
            }
          }}
        >
          <TableCell className="font-mono text-xs text-muted-foreground">
            {r.question_date}
          </TableCell>
          <TableCell>
            <StatusBadge status={r.status} />
          </TableCell>
          <TableCell className="text-right font-mono text-xs">
            {r.polymarket_probability != null
              ? `${(r.polymarket_probability * 100).toFixed(0)}%`
              : "—"}
          </TableCell>
          <TableCell className="text-right font-mono text-xs">
            {r.confidence_score != null ? (
              <span className="text-primary">{formatScorePercent(r.confidence_score)}</span>
            ) : "—"}
          </TableCell>
          <TableCell>
            <StrategyBadge strategy={r.strategy_used} />
          </TableCell>
          <TableCell className="text-right font-mono text-xs">
            {r.btc_target_price != null ? `$${r.btc_target_price.toLocaleString()}` : "—"}
          </TableCell>
          <TableCell className="text-right font-mono text-xs">
            {r.btc_actual_price != null ? `$${r.btc_actual_price.toLocaleString()}` : "—"}
          </TableCell>
          <TableCell className="text-right text-xs">{r.participant_count}</TableCell>
          <TableCell className="text-xs text-muted-foreground">
            {r.winner_name ?? "—"}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default async function PredictionsPage() {
  const [rounds, strategies] = await Promise.all([getRounds(), getStrategyStats()]);

  const openRounds = rounds.filter((r) => r.status === "open");
  const settledRounds = rounds.filter((r) => r.status === "settled");
  const completedWithActual = rounds.filter((r) => r.btc_actual_price != null).length;
  const avgConfidence =
    rounds.filter((r) => r.confidence_score != null).reduce((sum, r) => sum + (r.confidence_score ?? 0), 0) /
    Math.max(
      1,
      rounds.filter((r) => r.confidence_score != null).length
    );

  return (
    <div className="space-y-8">
      <AutoRefresh />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
            <LineChart className="h-3.5 w-3.5" />
            Active cycle
          </div>
          <h1 className="text-4xl font-bold text-white">Prediction Windows</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Submit and settle daily BTC target rounds. Strategy and confidence are derived from consensus.
          </p>
        </div>
        <Card className="border-white/5 bg-card/95">
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Rounds Summary</p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold text-white">{rounds.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Open</span>
                <span className="font-semibold text-primary">{openRounds.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Settled</span>
                <span className="font-semibold text-white">{settledRounds.length}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="border-white/5 bg-card/95">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Open Rounds</p>
            <p className="mt-2 text-3xl font-bold text-primary">{openRounds.length}</p>
          </CardContent>
        </Card>
        <Card className="border-white/5 bg-card/95">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Completed</p>
            <p className="mt-2 text-3xl font-bold text-white">{completedWithActual}</p>
          </CardContent>
        </Card>
        <Card className="border-white/5 bg-card/95">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Avg Confidence</p>
            <p className="mt-2 text-3xl font-bold text-white">{formatScorePercent(avgConfidence)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Strategy Performance</h2>
          <p className="text-sm text-muted-foreground">Win-rate and average return by strategy</p>
        </div>
      </div>

      {strategies.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {strategies.map((s) => {
            const winRate =
              s.total_trades > 0 ? Math.round((s.wins / s.total_trades) * 100) : 0;
            const avgPnlSats = s.avg_pnl_sats ?? 0;
            return (
              <Card key={s.strategy} className="border-white/5 bg-card/95">
                <CardContent className="pt-4 pb-4">
                  <StrategyBadge strategy={s.strategy} className="mb-2" />
                  <p className="text-xs text-muted-foreground">{s.total_trades} trades</p>
                  <p className="text-xs text-muted-foreground">{winRate}% win rate</p>
                  <p className="text-xs font-mono mt-1">
                    <span className={avgPnlSats >= 0 ? "text-primary" : "text-red-400"}>
                      {avgPnlSats >= 0 ? "+" : ""}
                      {avgPnlSats.toLocaleString()} avg
                    </span>
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Rounds table */}
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({rounds.length})</TabsTrigger>
          <TabsTrigger value="open">Open ({openRounds.length})</TabsTrigger>
          <TabsTrigger value="settled">Settled ({settledRounds.length})</TabsTrigger>
        </TabsList>

        {(["all", "open", "settled"] as const).map((tab) => {
          const data =
            tab === "all" ? rounds : tab === "open" ? openRounds : settledRounds;
          return (
            <TabsContent key={tab} value={tab}>
              <Card className="border-white/5 bg-card/95">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-background/40 hover:bg-background/40">
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Polymarket</TableHead>
                        <TableHead className="text-right">Confidence</TableHead>
                        <TableHead>Strategy</TableHead>
                        <TableHead className="text-right">Target</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                        <TableHead className="text-right">Participants</TableHead>
                        <TableHead>Winner</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <RoundsTable rounds={data} />
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
