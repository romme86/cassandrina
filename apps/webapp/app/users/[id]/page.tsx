import Link from "next/link";
import { notFound } from "next/navigation";
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
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { ScoreBar } from "@/components/score-bar";
import { StrategyBadge } from "@/components/strategy-badge";
import { AccuracyChart } from "@/components/accuracy-chart";
import { AutoRefresh } from "@/components/auto-refresh";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Target, Brain, ListOrdered, CreditCard, Coins } from "lucide-react";

export const revalidate = 30;

interface UserDetailRow {
  id: number;
  platform: string;
  platform_user_id: string;
  display_name: string;
  accuracy: number;
  congruency: number;
  joined_at: string;
  total_predictions: number;
  paid_predictions: number;
  total_sats_won: number;
}

interface PredictionHistoryRow {
  id: number;
  predicted_price: number;
  sats_amount: number;
  paid: boolean;
  created_at: string;
  question_date: string;
  btc_actual_price: number | null;
  btc_target_price: number | null;
  round_status: string;
  confidence_score: number | null;
  strategy_used: string | null;
}

async function getUserDetail(id: number) {
  const userRows = await query<UserDetailRow>(
    `SELECT u.id, u.platform, u.platform_user_id, u.display_name, u.accuracy, u.congruency, u.joined_at,
            COUNT(DISTINCT p.id)::int AS total_predictions,
            SUM(CASE WHEN p.paid THEN 1 ELSE 0 END)::int AS paid_predictions,
            COALESCE(SUM(be.delta_sats) FILTER (WHERE be.delta_sats > 0), 0)::int AS total_sats_won
     FROM users u
     LEFT JOIN predictions p ON p.user_id = u.id
     LEFT JOIN balance_entries be ON be.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [id]
  );
  return userRows[0] ?? null;
}

async function getPredictionHistory(userId: number): Promise<PredictionHistoryRow[]> {
  return query<PredictionHistoryRow>(
    `SELECT p.id, p.predicted_price, p.sats_amount, p.paid, p.created_at,
            r.question_date, r.btc_actual_price, r.btc_target_price,
            r.status AS round_status, r.confidence_score, r.strategy_used
     FROM predictions p
     JOIN prediction_rounds r ON r.id = p.round_id
     WHERE p.user_id = $1
     ORDER BY p.created_at DESC
     LIMIT 30`,
    [userId]
  );
}

function isCorrect(predicted: number, actual: number | null): boolean | null {
  if (actual == null) return null;
  return Math.abs(predicted - actual) / predicted <= 0.02;
}

function deltaPct(predicted: number, actual: number | null): string {
  if (actual == null) return "—";
  const pct = ((predicted - actual) / predicted) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function formatIdentity(user: Pick<UserDetailRow, "platform" | "platform_user_id">): string {
  return `${user.platform} · ${user.platform_user_id}`;
}

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) notFound();

  let user: UserDetailRow | null = null;
  let history: PredictionHistoryRow[] = [];
  try {
    [user, history] = await Promise.all([getUserDetail(id), getPredictionHistory(id)]);
  } catch {
    notFound();
  }

  if (!user) notFound();

  const chartData = history.map((p) => ({
    question_date: p.question_date,
    correct: isCorrect(p.predicted_price, p.btc_actual_price) ?? false,
    predicted_price: p.predicted_price,
    btc_actual_price: p.btc_actual_price,
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <AutoRefresh />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{user.display_name}</h1>
          <p className="text-muted-foreground text-sm">{formatIdentity(user)}</p>
          <p className="text-muted-foreground text-xs mt-0.5">
            Joined {new Date(user.joined_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/users">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Leaderboard
          </Link>
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Accuracy" value={`${user.accuracy.toFixed(1)}%`} icon={Target} />
        <StatCard label="Congruency" value={`${user.congruency.toFixed(1)}%`} icon={Brain} />
        <StatCard label="Predictions" value={user.total_predictions} icon={ListOrdered} />
        <StatCard label="Paid" value={user.paid_predictions} icon={CreditCard} />
        <StatCard label="Sats Won" value={user.total_sats_won.toLocaleString()} icon={Coins} />
      </div>

      {/* Accuracy chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Accuracy over last 15 rounds (lower Δ = better)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AccuracyChart data={chartData} />
        </CardContent>
      </Card>

      {/* Score bars */}
      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-2">Accuracy score</p>
            <ScoreBar value={user.accuracy} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2">Congruency score</p>
            <ScoreBar value={user.congruency} />
          </div>
        </CardContent>
      </Card>

      {/* Prediction history table */}
      <Card>
        <CardHeader>
          <CardTitle>Prediction History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm px-6 pb-6">No predictions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Predicted</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Δ%</TableHead>
                  <TableHead>Correct?</TableHead>
                  <TableHead className="text-right">Sats</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((p) => {
                  const correct = isCorrect(p.predicted_price, p.btc_actual_price);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">
                        {p.question_date}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${p.predicted_price.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {p.btc_actual_price != null
                          ? `$${p.btc_actual_price.toLocaleString()}`
                          : "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-xs ${
                          correct === true
                            ? "text-green-400"
                            : correct === false
                            ? "text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {deltaPct(p.predicted_price, p.btc_actual_price)}
                      </TableCell>
                      <TableCell>
                        {correct === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : correct ? (
                          <Badge variant="success">✓</Badge>
                        ) : (
                          <Badge variant="destructive">✗</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {p.sats_amount.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <StrategyBadge strategy={p.strategy_used} />
                      </TableCell>
                      <TableCell>
                        {p.paid ? (
                          <Badge variant="success">Paid</Badge>
                        ) : (
                          <Badge variant="secondary">Pending</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
