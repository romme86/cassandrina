// ── Domain types shared across webapp and other TS packages ──

export interface User {
  id: number;
  platform: string;
  platform_user_id: string;
  display_name: string;
  accuracy: number;
  congruency: number;
  joined_at: string;
}

export interface PredictionRound {
  id: number;
  question_date: string;
  target_hour: number;
  open_at: string;
  close_at: string | null;
  polymarket_probability: number | null;
  status: "open" | "closed" | "settled";
  btc_target_low_price: number | null;
  btc_target_high_price: number | null;
  btc_target_price: number | null;
  btc_actual_low_price: number | null;
  btc_actual_high_price: number | null;
  btc_actual_price: number | null;
  confidence_score: number | null;
  strategy_used: "A" | "B" | "C" | "D" | "E" | null;
}

export interface Prediction {
  id: number;
  round_id: number;
  user_id: number;
  predicted_low_price: number;
  predicted_high_price: number;
  predicted_price: number;
  sats_amount: number;
  lightning_invoice: string | null;
  paid: boolean;
  paid_at: string | null;
  created_at: string;
}

export interface Trade {
  id: number;
  round_id: number;
  strategy: "A" | "B" | "C" | "D" | "E";
  direction: "long" | "short";
  entry_price: number;
  target_price: number;
  leverage: number;
  sats_deployed: number;
  status: "open" | "closed" | "liquidated";
  pnl_sats: number | null;
  opened_at: string;
  closed_at: string | null;
}

export interface BalanceEntry {
  id: number;
  user_id: number;
  round_id: number | null;
  delta_sats: number;
  reason: string;
  created_at: string;
}
