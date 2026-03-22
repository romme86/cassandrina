package plugin

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Bot struct {
	cfg            *Config
	api            *WebappClient
	sub            *RedisSubscriber
	telegram       TelegramGateway
	pendingMu      sync.Mutex
	pendingInvoices map[int64]string
}

func NewBot(cfg *Config) (*Bot, error) {
	return NewBotWithGateway(cfg, NewTelegramClient(cfg.BotToken))
}

func NewBotWithGateway(cfg *Config, telegram TelegramGateway) (*Bot, error) {
	sub, err := NewRedisSubscriber(cfg.RedisURL, nil)
	if err != nil {
		return nil, fmt.Errorf("redis subscriber: %w", err)
	}

	bot := &Bot{
		cfg:             cfg,
		api:             NewWebappClient(cfg.WebappAPIURL),
		sub:             sub,
		telegram:        telegram,
		pendingInvoices: make(map[int64]string),
	}
	sub.handler = bot.handleRedisEvent
	return bot, nil
}

func (b *Bot) Run(ctx context.Context) error {
	errCh := make(chan error, 2)

	go func() {
		errCh <- b.sub.Run(ctx)
	}()

	go func() {
		errCh <- b.pollUpdates(ctx)
	}()

	select {
	case <-ctx.Done():
		return nil
	case err := <-errCh:
		return err
	}
}

func (b *Bot) pollUpdates(ctx context.Context) error {
	offset := 0

	for {
		updates, err := b.telegram.GetUpdates(ctx, offset, 30)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			log.Printf("[telegram] getUpdates failed: %v", err)
			time.Sleep(2 * time.Second)
			continue
		}

		for _, update := range updates {
			offset = update.UpdateID + 1
			b.handleUpdate(ctx, update)
		}
	}
}

func (b *Bot) handleUpdate(ctx context.Context, update Update) {
	if update.Message == nil || update.Message.From == nil || update.Message.From.IsBot {
		return
	}

	msg := update.Message
	switch msg.Chat.Type {
	case "private":
		b.handlePrivateMessage(ctx, msg)
	case "group", "supergroup":
		if msg.Chat.ID == b.cfg.GroupChatID {
			b.handleGroupMessage(ctx, msg)
		}
	}
}

func (b *Bot) handleGroupMessage(ctx context.Context, msg *Message) {
	pred, err := ParsePrediction(msg.Text, b.cfg.MinSats, b.cfg.MaxSats)
	if err != nil {
		return
	}

	senderID := strconv.FormatInt(msg.From.ID, 10)
	displayName := telegramDisplayName(msg.From)

	resp, err := b.api.CreatePrediction(PredictionRequest{
		Platform:       "telegram",
		PlatformUserID: senderID,
		DisplayName:    displayName,
		PredictedPrice: pred.PredictedPrice,
		SatsAmount:     pred.SatsAmount,
	})
	if err != nil {
		log.Printf("[bot] failed to create prediction for %s: %v", senderID, err)
		_ = b.telegram.SendMessage(
			ctx,
			msg.Chat.ID,
			"Could not register your prediction. Please try again.",
			msg.MessageID,
		)
		return
	}

	invoiceMessage := fmt.Sprintf(
		"Your prediction is registered.\nPrice: $%.0f\nSats: %d\n\nPay this Lightning invoice to confirm:\n%s",
		pred.PredictedPrice,
		pred.SatsAmount,
		resp.LightningInvoice,
	)
	if err := b.telegram.SendMessage(ctx, msg.From.ID, invoiceMessage, 0); err != nil {
		log.Printf("[bot] failed to DM %s: %v", senderID, err)
		b.storePendingInvoice(msg.From.ID, invoiceMessage)

		startLink := b.telegram.DeepLink(ctx)
		reply := "I couldn't DM your invoice yet. Start a private chat with this bot and send /start, then I'll deliver the pending invoice."
		if startLink != "" {
			reply = "I couldn't DM your invoice yet. Open " + startLink + " and send /start, then I'll deliver the pending invoice."
		}
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, reply, msg.MessageID)
	}
}

func (b *Bot) handlePrivateMessage(ctx context.Context, msg *Message) {
	pendingInvoice, ok := b.pullPendingInvoice(msg.Chat.ID)
	if ok {
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, pendingInvoice, 0)
		return
	}

	_ = b.telegram.SendMessage(
		ctx,
		msg.Chat.ID,
		"Predictions are submitted in the group as '<price> <sats>'. If you had a pending invoice, it will appear here automatically.",
		0,
	)
}

func (b *Bot) handleRedisEvent(channel string, payload map[string]interface{}) {
	ctx := context.Background()

	switch {
	case strings.HasSuffix(channel, "prediction:open"):
		targetHour, _ := payload["target_hour"].(float64)
		minSats, _ := payload["min_sats"].(float64)
		maxSats, _ := payload["max_sats"].(float64)
		msg := fmt.Sprintf(
			"Daily BTC Prediction\n\nWhat will BTC's price be at %02d:00 UTC today?\n\nReply with: <price> <sats> (example: 95000 500)\nMin: %d sats | Max: %d sats",
			int(targetHour), intOrDefault(minSats, b.cfg.MinSats), intOrDefault(maxSats, b.cfg.MaxSats),
		)
		_ = b.telegram.SendMessage(ctx, b.cfg.GroupChatID, msg, 0)

	case strings.HasSuffix(channel, "prediction:close"):
		paidCount, _ := payload["paid_count"].(float64)
		totalSats, _ := payload["total_sats"].(float64)
		closeReason, _ := payload["close_reason"].(string)
		_ = b.telegram.SendMessage(
			ctx,
			b.cfg.GroupChatID,
			fmt.Sprintf(
				"Prediction window closed\n\nPaid entries: %d\nTotal deployed: %d sats\nReason: %s",
				int(paidCount),
				int(totalSats),
				closeReason,
			),
			0,
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
		_ = b.telegram.SendMessage(
			ctx,
			b.cfg.GroupChatID,
			fmt.Sprintf(
				"Trade opened (%s)\n\nStrategy: %s\nDirection: %s\nEntry: $%.2f\nTarget: $%.2f\nDeployed: %d sats",
				mode,
				strategy,
				strings.ToUpper(direction),
				entryPrice,
				targetPrice,
				int(satsDeployed),
			),
			0,
		)

	case strings.HasSuffix(channel, "trade:closed"):
		pnlSats, _ := payload["pnl_sats"].(float64)
		_ = b.telegram.SendMessage(
			ctx,
			b.cfg.GroupChatID,
			fmt.Sprintf("Trade closed\n\nRound PnL: %+d sats", int(pnlSats)),
			0,
		)

	case strings.HasSuffix(channel, "trade:liquidated"):
		pnlSats, _ := payload["pnl_sats"].(float64)
		_ = b.telegram.SendMessage(
			ctx,
			b.cfg.GroupChatID,
			fmt.Sprintf(
				"Liquidation alert\n\nThe position was liquidated.\nRound PnL: %+d sats",
				int(pnlSats),
			),
			0,
		)

	case strings.HasSuffix(channel, "stats:8h"):
		participantCount, _ := payload["participant_count"].(float64)
		paidCount, _ := payload["paid_count"].(float64)
		totalSats, _ := payload["total_sats"].(float64)
		hoursToTarget, _ := payload["hours_to_target"].(float64)
		_ = b.telegram.SendMessage(
			ctx,
			b.cfg.GroupChatID,
			fmt.Sprintf(
				"%d-hour portfolio update\n\nParticipants: %d\nPaid: %d\nTotal sats: %d",
				int(hoursToTarget),
				int(participantCount),
				int(paidCount),
				int(totalSats),
			),
			0,
		)

	case strings.HasSuffix(channel, "weekly:vote"):
		_ = b.telegram.SendMessage(
			ctx,
			b.cfg.GroupChatID,
			"Weekly strategy vote\n\nWhich risk strategy for next week?\nA - Aggressive (20x-40x futures)\nB - Moderate (up to 20x futures)\nC - Grid (neutral)\nD - Safe (spot, 10% TP)\nE - Conservative (spot, 2% TP)\n\nReply with A, B, C, D, or E.",
			0,
		)

	default:
		log.Printf("[bot] unhandled event: %s", channel)
	}
}

func (b *Bot) storePendingInvoice(chatID int64, message string) {
	b.pendingMu.Lock()
	defer b.pendingMu.Unlock()
	b.pendingInvoices[chatID] = message
}

func (b *Bot) pullPendingInvoice(chatID int64) (string, bool) {
	b.pendingMu.Lock()
	defer b.pendingMu.Unlock()

	message, ok := b.pendingInvoices[chatID]
	if ok {
		delete(b.pendingInvoices, chatID)
	}
	return message, ok
}

func intOrDefault(value float64, fallback int) int {
	if value == 0 {
		return fallback
	}
	return int(value)
}

func telegramDisplayName(user *TelegramUser) string {
	if user == nil {
		return "telegram-user"
	}
	if user.Username != "" {
		return "@" + user.Username
	}

	name := strings.TrimSpace(strings.TrimSpace(user.FirstName + " " + user.LastName))
	if name != "" {
		return name
	}

	return "telegram-" + strconv.FormatInt(user.ID, 10)
}
