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
import { AutoRefresh } from "@/components/auto-refresh";
import { LineChart } from "lucide-react";

export const revalidate = 30;

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
       ORDER BY r.question_date DESC
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
              ROUND(AVG(pnl_sats))::int AS avg_pnl_sats,
              SUM(pnl_sats)::int AS total_pnl_sats
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
          className="cursor-pointer hover:bg-secondary/50 border-white/5"
          onClick={() => {
            if (typeof window !== "undefined") window.location.href = `/predictions/${r.id}`;
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
              <span className="text-primary">{r.confidence_score.toFixed(1)}%</span>
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

  return (
    <div className="space-y-6">
      <AutoRefresh />

      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <LineChart className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Predictions</h1>
          <p className="text-sm text-muted-foreground">{rounds.length} total rounds</p>
        </div>
      </div>

      {/* Strategy performance cards */}
      {strategies.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {strategies.map((s) => {
            const winRate =
              s.total_trades > 0 ? Math.round((s.wins / s.total_trades) * 100) : 0;
            return (
              <Card key={s.strategy} className="border-white/5">
                <CardContent className="pt-4 pb-4">
                  <StrategyBadge strategy={s.strategy} className="mb-2" />
                  <p className="text-xs text-muted-foreground">{s.total_trades} trades</p>
                  <p className="text-xs text-muted-foreground">{winRate}% win rate</p>
                  <p className="text-xs font-mono mt-1">
                    <span className={s.avg_pnl_sats >= 0 ? "text-primary" : "text-red-400"}>
                      {s.avg_pnl_sats >= 0 ? "+" : ""}
                      {s.avg_pnl_sats.toLocaleString()} avg
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
        <TabsList className="bg-secondary border border-white/5">
          <TabsTrigger value="all">All ({rounds.length})</TabsTrigger>
          <TabsTrigger value="open">Open ({openRounds.length})</TabsTrigger>
          <TabsTrigger value="settled">Settled ({settledRounds.length})</TabsTrigger>
        </TabsList>

        {(["all", "open", "settled"] as const).map((tab) => {
          const data =
            tab === "all" ? rounds : tab === "open" ? openRounds : settledRounds;
          return (
            <TabsContent key={tab} value={tab}>
              <Card className="border-white/5">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/5 hover:bg-transparent">
                        <TableHead className="text-muted-foreground">Date</TableHead>
                        <TableHead className="text-muted-foreground">Status</TableHead>
                        <TableHead className="text-right text-muted-foreground">Polymarket</TableHead>
                        <TableHead className="text-right text-muted-foreground">Confidence</TableHead>
                        <TableHead className="text-muted-foreground">Strategy</TableHead>
                        <TableHead className="text-right text-muted-foreground">Target</TableHead>
                        <TableHead className="text-right text-muted-foreground">Actual</TableHead>
                        <TableHead className="text-right text-muted-foreground">Participants</TableHead>
                        <TableHead className="text-muted-foreground">Winner</TableHead>
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
