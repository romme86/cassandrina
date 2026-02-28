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
		msg := fmt.Sprintf(
			"📊 *Daily BTC Prediction*\n\n"+
				"What will BTC's price be at %02d:00 UTC today?\n\n"+
				"Reply with: `<price> <sats>` (e.g. `95000 500`)\n"+
				"Min: %d sats | Max: %d sats",
			int(targetHour), b.cfg.MinSats, b.cfg.MaxSats,
		)
		_ = b.sendGroup(msg)

	case strings.HasSuffix(channel, "trade:liquidated"):
		_ = b.sendGroup(
			"🔴 *Liquidation Alert!*\n\n" +
				"The position was liquidated. All deployed sats have been lost.\n" +
				"Better luck next round! 💪",
		)

	case strings.HasSuffix(channel, "stats:8h"):
		// Detailed stats are fetched from the webapp API and formatted separately.
		_ = b.sendGroup("📊 *8-Hour Portfolio Update* — Check the dashboard for details.")

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
