import { query } from "@/lib/db";

export interface GroupLeaderboardRow {
  group_name: string;
  telegram_group_chat_id: string;
  average_accuracy: number;
  average_congruency: number;
  balance_sats: number;
  profit_sats: number;
  total_predictions: number;
  participant_count: number;
}

export async function getGroupLeaderboard(): Promise<GroupLeaderboardRow[]> {
  return query<GroupLeaderboardRow>(
    `WITH group_predictions AS (
       SELECT
         COALESCE(
           NULLIF(TRIM(p.telegram_group_chat_id), ''),
           NULLIF(TRIM(p.telegram_group_name), ''),
           'legacy-telegram'
         ) AS group_key,
         NULLIF(TRIM(p.telegram_group_chat_id), '') AS telegram_group_chat_id,
         NULLIF(TRIM(p.telegram_group_name), '') AS telegram_group_name,
         p.user_id,
         p.round_id,
         p.created_at
       FROM predictions p
       INNER JOIN users u ON u.id = p.user_id
       WHERE u.platform = 'telegram'
     ),
     group_prediction_stats AS (
       SELECT
         gp.group_key,
         COALESCE(
           (ARRAY_AGG(gp.telegram_group_name ORDER BY gp.created_at DESC)
             FILTER (WHERE gp.telegram_group_name IS NOT NULL))[1],
           'Telegram group'
         ) AS group_name,
         COALESCE(
           (ARRAY_AGG(gp.telegram_group_chat_id ORDER BY gp.created_at DESC)
             FILTER (WHERE gp.telegram_group_chat_id IS NOT NULL))[1],
           ''
         ) AS telegram_group_chat_id,
         COUNT(*)::int AS total_predictions,
         COUNT(DISTINCT gp.user_id)::int AS participant_count,
         COALESCE(SUM(round_balance.balance_sats), 0)::int AS balance_sats,
         COALESCE(SUM(round_balance.profit_sats), 0)::int AS profit_sats
       FROM group_predictions gp
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(SUM(be.delta_sats), 0)::int AS balance_sats,
           COALESCE(
             SUM(CASE WHEN be.reason <> 'invoice_paid' THEN be.delta_sats ELSE 0 END),
             0
           )::int AS profit_sats
         FROM balance_entries be
         WHERE be.user_id = gp.user_id
           AND be.round_id = gp.round_id
       ) round_balance ON TRUE
       GROUP BY gp.group_key
     ),
     group_member_stats AS (
       SELECT
         distinct_members.group_key,
         AVG(u.accuracy)::float AS average_accuracy,
         AVG(u.congruency)::float AS average_congruency
       FROM (
         SELECT DISTINCT group_key, user_id
         FROM group_predictions
       ) distinct_members
       INNER JOIN users u ON u.id = distinct_members.user_id
       GROUP BY distinct_members.group_key
     )
     SELECT
       gps.group_name,
       gps.telegram_group_chat_id,
       COALESCE(gms.average_accuracy, 0.5)::float AS average_accuracy,
       COALESCE(gms.average_congruency, 0.5)::float AS average_congruency,
       gps.balance_sats,
       gps.profit_sats,
       gps.total_predictions,
       gps.participant_count
     FROM group_prediction_stats gps
     INNER JOIN group_member_stats gms ON gms.group_key = gps.group_key
     ORDER BY gps.balance_sats DESC, gms.average_accuracy DESC, gms.average_congruency DESC, gps.group_name ASC`
  );
}
