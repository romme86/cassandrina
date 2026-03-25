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
import { ArrowLeft, Activity, TrendingUp } from "lucide-react";

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
    `SELECT *
     FROM trades
     WHERE round_id = $1
     ORDER BY opened_at DESC
     LIMIT 1`,
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
      ? (
          ((round.btc_actual_price - round.btc_target_price) / round.btc_target_price) *
          100
        ).toFixed(2)
      : null;

  const polyPct =
    round.polymarket_probability != null
      ? (round.polymarket_probability * 100).toFixed(1)
      : "—";

  // Paid vs pending stats
  const paidCount = predictions.filter((p) => p.paid).length;
  const pendingCount = predictions.length - paidCount;

  // Bullish vs bearish from prediction prices vs target
  const bullishCount =
    round.btc_target_price != null
      ? predictions.filter((p) => p.predicted_price >= round.btc_target_price!).length
      : 0;
  const bearishCount = predictions.length - bullishCount;
  const bullishPct = predictions.length > 0 ? Math.round((bullishCount / predictions.length) * 100) : 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <AutoRefresh />

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-white">
              <Link href="/predictions">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Predictions
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl font-bold text-white mt-2">{round.question_date}</h1>
          <StatusBadge status={round.status} className="mt-1" />
        </div>
      </div>

      {/* Price summary + confidence */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border-border/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Price Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Target</p>
                <p className="text-lg font-bold font-mono text-white">
                  {round.btc_target_price != null
                    ? `$${round.btc_target_price.toLocaleString()}`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Actual</p>
                <p className="text-lg font-bold font-mono text-white">
                  {round.btc_actual_price != null
                    ? `$${round.btc_actual_price.toLocaleString()}`
                    : "—"}
                </p>
              </div>
              {priceDelta != null && (
                <div>
                  <p className="text-xs text-muted-foreground">Δ target</p>
                  <p
                    className={`text-lg font-bold font-mono ${
                      parseFloat(priceDelta) >= 0 ? "text-primary" : "text-red-400"
                    }`}
                  >
                    {parseFloat(priceDelta) >= 0 ? "+" : ""}
                    {priceDelta}%
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-primary" />
              Confidence Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {round.confidence_score != null ? (
              <div>
                <p className="text-3xl font-bold text-primary">
                  {round.confidence_score.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  (Accuracy + Congruency + Polymarket {polyPct}%) / 3
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Not computed yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Market sentiment */}
      {predictions.length > 0 && (
        <Card className="border-border/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Market Sentiment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-2">Bullish</p>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${bullishPct}%` }}
                  />
                </div>
                <p className="text-sm font-bold text-primary mt-1">{bullishPct}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2">Bearish</p>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full transition-all"
                    style={{ width: `${100 - bullishPct}%` }}
                  />
                </div>
                <p className="text-sm font-bold text-red-400 mt-1">{100 - bullishPct}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sats Paid</p>
                <p className="text-lg font-bold text-primary">{paidCount}</p>
                <p className="text-xs text-muted-foreground">of {predictions.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-lg font-bold text-yellow-400">{pendingCount}</p>
                <p className="text-xs text-muted-foreground">awaiting payment</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trade card */}
      {trade && (
        <Card className="border-border/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              Trade
            </CardTitle>
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
                  className={`font-bold ${
                    trade.direction === "long" ? "text-primary" : "text-red-400"
                  }`}
                >
                  {trade.direction.toUpperCase()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Leverage</p>
                <p className="font-mono font-bold">{trade.leverage}x</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Entry → Target</p>
                <p className="font-mono">
                  ${trade.entry_price.toLocaleString()} → $
                  {trade.target_price.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">P&L</p>
                <p
                  className={`font-mono font-bold ${
                    (trade.pnl_sats ?? 0) >= 0 ? "text-primary" : "text-red-400"
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
      <Card className="border-border/30">
        <CardHeader>
          <CardTitle className="text-base">Predictions ({predictions.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {predictions.length === 0 ? (
            <p className="text-muted-foreground text-sm px-6 pb-6">No predictions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/30 hover:bg-transparent">
                  <TableHead className="text-muted-foreground">User</TableHead>
                  <TableHead className="text-right text-muted-foreground">Predicted</TableHead>
                  <TableHead className="text-right text-muted-foreground">Δ from Actual</TableHead>
                  <TableHead className="text-right text-muted-foreground">Sats</TableHead>
                  <TableHead className="text-muted-foreground">Paid</TableHead>
                  <TableHead className="text-muted-foreground">Correct?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {predictions.map((p) => {
                  const correct = isCorrect(p.predicted_price, round.btc_actual_price);
                  return (
                    <TableRow key={p.id} className="border-border/30 hover:bg-secondary/50">
                      <TableCell className="font-medium text-white">
                        {p.display_name}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        ${p.predicted_price.toLocaleString()}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-xs ${
                          correct === true
                            ? "text-primary"
                            : correct === false
                            ? "text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {deltaPct(p.predicted_price, round.btc_actual_price)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
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
