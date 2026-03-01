import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import type { PredictionRound, Trade } from "@cassandrina/shared";
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
import { StatusBadge } from "@/components/status-badge";
import { StrategyBadge } from "@/components/strategy-badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const revalidate = 30;

interface RoundPrediction {
  id: number;
  predicted_price: number;
  sats_amount: number;
  paid: boolean;
  created_at: string;
  display_name: string;
  user_accuracy: number;
}

async function getRound(id: number): Promise<PredictionRound | null> {
  const rows = await query<PredictionRound>(
    "SELECT * FROM prediction_rounds WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

async function getOpenTrade(roundId: number): Promise<Trade | null> {
  const rows = await query<Trade>(
    `SELECT t.* FROM trades t
     JOIN prediction_rounds r ON r.id = $1
     WHERE t.opened_at::date = r.question_date
     ORDER BY t.opened_at DESC LIMIT 1`,
    [roundId]
  );
  return rows[0] ?? null;
}

async function getRoundPredictions(roundId: number): Promise<RoundPrediction[]> {
  return query<RoundPrediction>(
    `SELECT p.id, p.predicted_price, p.sats_amount, p.paid, p.created_at,
            u.display_name, u.accuracy AS user_accuracy
     FROM predictions p
     JOIN users u ON u.id = p.user_id
     WHERE p.round_id = $1
     ORDER BY p.sats_amount DESC`,
    [roundId]
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

export default async function RoundDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) notFound();

  let round: PredictionRound | null = null;
  let trade: Trade | null = null;
  let predictions: RoundPrediction[] = [];

  try {
    [round, trade, predictions] = await Promise.all([
      getRound(id),
      getOpenTrade(id),
      getRoundPredictions(id),
    ]);
  } catch {
    notFound();
  }

  if (!round) notFound();

  const priceDelta =
    round.btc_actual_price != null && round.btc_target_price != null
      ? (((round.btc_actual_price - round.btc_target_price) / round.btc_target_price) * 100).toFixed(2)
      : null;

  // Confidence breakdown: (accuracy + congruency + polymarket*100) / 3
  const polyPct =
    round.polymarket_probability != null
      ? (round.polymarket_probability * 100).toFixed(1)
      : "—";

  return (
    <div className="space-y-6 max-w-4xl">
      <AutoRefresh />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{round.question_date}</h1>
          <StatusBadge status={round.status} className="mt-1" />
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/predictions">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Predictions
          </Link>
        </Button>
      </div>

      {/* Price summary */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-muted-foreground">Target Price</p>
              <p className="text-xl font-bold font-mono">
                {round.btc_target_price != null
                  ? `$${round.btc_target_price.toLocaleString()}`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Actual Price</p>
              <p className="text-xl font-bold font-mono">
                {round.btc_actual_price != null
                  ? `$${round.btc_actual_price.toLocaleString()}`
                  : "—"}
              </p>
            </div>
            {priceDelta != null && (
              <div>
                <p className="text-xs text-muted-foreground">Δ from target</p>
                <p
                  className={`text-xl font-bold font-mono ${
                    parseFloat(priceDelta) >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {parseFloat(priceDelta) >= 0 ? "+" : ""}
                  {priceDelta}%
                </p>
              </div>
            )}
          </div>

          {round.confidence_score != null && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Confidence breakdown:{" "}
                <span className="font-mono font-medium text-foreground">
                  {round.confidence_score.toFixed(1)}%
                </span>{" "}
                = (Accuracy + Congruency + Polymarket {polyPct}%) / 3
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trade card */}
      {trade && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Trade</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Strategy</p>
                <StrategyBadge strategy={trade.strategy} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Direction</p>
                <p
                  className={`font-semibold ${
                    trade.direction === "long" ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {trade.direction.toUpperCase()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Leverage</p>
                <p className="font-mono">{trade.leverage}x</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Entry → Target</p>
                <p className="font-mono">
                  ${trade.entry_price.toLocaleString()} → ${trade.target_price.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">P&L</p>
                <p
                  className={`font-mono font-semibold ${
                    (trade.pnl_sats ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {trade.pnl_sats != null
                    ? `${trade.pnl_sats >= 0 ? "+" : ""}${trade.pnl_sats} sats`
                    : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Predictions table */}
      <Card>
        <CardHeader>
          <CardTitle>Predictions ({predictions.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {predictions.length === 0 ? (
            <p className="text-muted-foreground text-sm px-6 pb-6">No predictions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Predicted</TableHead>
                  <TableHead className="text-right">Δ from Actual</TableHead>
                  <TableHead className="text-right">Sats</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Correct?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {predictions.map((p) => {
                  const correct = isCorrect(p.predicted_price, round.btc_actual_price);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.display_name}</TableCell>
                      <TableCell className="text-right font-mono">
                        ${p.predicted_price.toLocaleString()}
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
                        {deltaPct(p.predicted_price, round.btc_actual_price)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {p.sats_amount.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {p.paid ? (
                          <Badge variant="success">Paid</Badge>
                        ) : (
                          <Badge variant="secondary">Pending</Badge>
                        )}
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
