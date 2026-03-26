import { z } from "zod";

// ── API: POST /api/predictions ───────────────────────────────

export const CreatePredictionSchema = z.object({
  platform: z.string().min(1),
  platform_user_id: z.string().min(1),
  display_name: z.string().min(1).optional(),
  predicted_low_price: z.number().positive(),
  predicted_high_price: z.number().positive(),
  sats_amount: z
    .number()
    .int()
    .min(1, "Must be at least 1 sat")
    .max(100_000, "Maximum 100,000 sats"),
  round_id: z.number().int().positive().optional(),
}).refine((input) => input.predicted_high_price >= input.predicted_low_price, {
  message: "predicted_high_price must be greater than or equal to predicted_low_price",
  path: ["predicted_high_price"],
});

export type CreatePredictionInput = z.infer<typeof CreatePredictionSchema>;

// ── API: POST /api/config ────────────────────────────────────

export const BotConfigSchema = z.object({
  prediction_target_hour: z.number().int().min(0).max(23).optional(),
  prediction_open_hour: z.number().int().min(0).max(23).optional(),
  prediction_window_hours: z.number().int().min(1).max(12).optional(),
  min_sats: z.number().int().min(1).optional(),
  max_sats: z.number().int().min(1).optional(),
  weekly_vote_day: z.number().int().min(0).max(6).optional(),
  weekly_vote_hour: z.number().int().min(0).max(23).optional(),
  trading_enabled: z.boolean().optional(),
});

export type BotConfigInput = z.infer<typeof BotConfigSchema>;

// ── API: POST /api/wallet/withdraw ──────────────────────────

export const WithdrawSchema = z.object({
  platform: z.string().min(1),
  platform_user_id: z.string().min(1),
  payment_request: z.string().min(1),
  amount_sats: z.number().int().min(1),
});

export type WithdrawInput = z.infer<typeof WithdrawSchema>;
