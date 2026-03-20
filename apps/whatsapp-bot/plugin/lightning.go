// Package plugin implements the Cassandrina PicoClaw plugin.
//
// This file handles the Lightning Network invoice flow:
//   1. User sends "<price> <sats>" in the WhatsApp group.
//   2. Plugin parses the message, calls POST /api/predictions.
//   3. Webapp creates an LND invoice and returns the BOLT-11 string.
//   4. Plugin sends the invoice back as a private DM to the user.
package plugin

import (
	"context"
	"fmt"
	"log"
	"strings"
)

// Bot is the top-level plugin, wiring together parser, API client, and Redis.
type Bot struct {
	cfg       *Config
	api       *WebappClient
	sub       *RedisSubscriber
	sendDM    func(jid, text string) error // injected by PicoClaw integration
	sendGroup func(text string) error      // injected by PicoClaw integration
}

// NewBot creates a fully configured Bot.
// sendDM and sendGroup are callbacks provided by the PicoClaw host.
func NewBot(
	cfg *Config,
	sendDM func(jid, text string) error,
	sendGroup func(text string) error,
) (*Bot, error) {
	api := NewWebappClient(cfg.WebappAPIURL)
	sub, err := NewRedisSubscriber(cfg.RedisURL, nil) // handler set below
	if err != nil {
		return nil, fmt.Errorf("redis subscriber: %w", err)
	}

	bot := &Bot{
		cfg:       cfg,
		api:       api,
		sub:       sub,
		sendDM:    sendDM,
		sendGroup: sendGroup,
	}
	sub.handler = bot.handleRedisEvent
	return bot, nil
}

// HandleMessage processes an incoming WhatsApp message.
// It is called by the PicoClaw host for every group message.
func (b *Bot) HandleMessage(senderJID, text string) {
	pred, err := ParsePrediction(text, b.cfg.MinSats, b.cfg.MaxSats)
	if err != nil {
		// Not a prediction message — silently ignore non-prediction messages
		return
	}

	resp, err := b.api.CreatePrediction(PredictionRequest{
		WhatsAppJID:    senderJID,
		PredictedPrice: pred.PredictedPrice,
		SatsAmount:     pred.SatsAmount,
	})
	if err != nil {
		log.Printf("[bot] failed to create prediction for %s: %v", senderJID, err)
		_ = b.sendDM(senderJID, "⚠️ Could not register your prediction. Please try again.")
		return
	}

	msg := fmt.Sprintf(
		"⚡ *Your prediction is registered!*\n"+
			"💰 Price: $%.0f\n"+
			"🔋 Sats: %d\n\n"+
			"Please pay this Lightning invoice to confirm:\n```\n%s\n```",
		pred.PredictedPrice,
		pred.SatsAmount,
		resp.LightningInvoice,
	)
	if err := b.sendDM(senderJID, msg); err != nil {
		log.Printf("[bot] failed to DM %s: %v", senderJID, err)
	}
}

// Run starts the Redis subscriber. Blocks until ctx is cancelled.
func (b *Bot) Run(ctx context.Context) error {
	return b.sub.Run(ctx)
}

// handleRedisEvent dispatches inbound events to the appropriate WhatsApp message.
func (b *Bot) handleRedisEvent(channel string, payload map[string]interface{}) {
	switch {
	case strings.HasSuffix(channel, "prediction:open"):
		targetHour, _ := payload["target_hour"].(float64)
		minSats, _ := payload["min_sats"].(float64)
		maxSats, _ := payload["max_sats"].(float64)
		msg := fmt.Sprintf(
			"📊 *Daily BTC Prediction*\n\n"+
				"What will BTC's price be at %02d:00 UTC today?\n\n"+
				"Reply with: `<price> <sats>` (e.g. `95000 500`)\n"+
				"Min: %d sats | Max: %d sats",
			int(targetHour), intOrDefault(minSats, b.cfg.MinSats), intOrDefault(maxSats, b.cfg.MaxSats),
		)
		_ = b.sendGroup(msg)

	case strings.HasSuffix(channel, "prediction:close"):
		paidCount, _ := payload["paid_count"].(float64)
		totalSats, _ := payload["total_sats"].(float64)
		closeReason, _ := payload["close_reason"].(string)
		_ = b.sendGroup(
			fmt.Sprintf(
				"🔒 *Prediction window closed*\n\nPaid entries: %d\nTotal deployed: %d sats\nReason: %s",
				int(paidCount),
				int(totalSats),
				closeReason,
			),
		)

	case strings.HasSuffix(channel, "trade:opened"):
		strategy, _ := payload["strategy"].(string)
		direction, _ := payload["direction"].(string)
		entryPrice, _ := payload["entry_price"].(float64)
		targetPrice, _ := payload["target_price"].(float64)
		satsDeployed, _ := payload["sats_deployed"].(float64)
		dryRun, _ := payload["dry_run"].(bool)
		mode := "LIVE"
		if dryRun {
			mode = "DRY RUN"
		}
		_ = b.sendGroup(
			fmt.Sprintf(
				"📈 *Trade opened (%s)*\n\nStrategy: %s\nDirection: %s\nEntry: $%.2f\nTarget: $%.2f\nDeployed: %d sats",
				mode,
				strategy,
				strings.ToUpper(direction),
				entryPrice,
				targetPrice,
				int(satsDeployed),
			),
		)

	case strings.HasSuffix(channel, "trade:closed"):
		pnlSats, _ := payload["pnl_sats"].(float64)
		_ = b.sendGroup(
			fmt.Sprintf("✅ *Trade closed*\n\nRound PnL: %+d sats", int(pnlSats)),
		)

	case strings.HasSuffix(channel, "trade:liquidated"):
		pnlSats, _ := payload["pnl_sats"].(float64)
		_ = b.sendGroup(
			fmt.Sprintf(
				"🔴 *Liquidation Alert!*\n\nThe position was liquidated.\nRound PnL: %+d sats\nBetter luck next round! 💪",
				int(pnlSats),
			),
		)

	case strings.HasSuffix(channel, "stats:8h"):
		participantCount, _ := payload["participant_count"].(float64)
		paidCount, _ := payload["paid_count"].(float64)
		totalSats, _ := payload["total_sats"].(float64)
		hoursToTarget, _ := payload["hours_to_target"].(float64)
		_ = b.sendGroup(
			fmt.Sprintf(
				"📊 *%d-Hour Portfolio Update*\n\nParticipants: %d\nPaid: %d\nTotal sats: %d",
				int(hoursToTarget),
				int(participantCount),
				int(paidCount),
				int(totalSats),
			),
		)

	case strings.HasSuffix(channel, "weekly:vote"):
		_ = b.sendGroup(
			"🗳️ *Weekly Strategy Vote*\n\n" +
				"Which risk strategy for next week?\n" +
				"A — Aggressive (20x–40x futures)\n" +
				"B — Moderate (up to 20x futures)\n" +
				"C — Grid (neutral)\n" +
				"D — Safe (spot, 10% TP)\n" +
				"E — Conservative (spot, 2% TP)\n\n" +
				"Reply with A, B, C, D, or E.",
		)

	default:
		log.Printf("[bot] unhandled event: %s", channel)
	}
}

func intOrDefault(value float64, fallback int) int {
	if value == 0 {
		return fallback
	}
	return int(value)
}
