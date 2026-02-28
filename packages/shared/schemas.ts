import { z } from "zod";

// ── API: POST /api/predictions ───────────────────────────────

export const CreatePredictionSchema = z.object({
  whatsapp_jid: z.string().min(1),
  predicted_price: z.number().positive(),
  sats_amount: z
    .number()
    .int()
    .min(1, "Must be at least 1 sat")
    .max(100_000, "Maximum 100,000 sats"),
  round_id: z.number().int().positive().optional(),
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
