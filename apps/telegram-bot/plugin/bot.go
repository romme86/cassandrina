package plugin

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Bot struct {
	cfg             *Config
	api             *WebappClient
	sub             *RedisSubscriber
	telegram        TelegramGateway
	pendingMu       sync.Mutex
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
	bot.api.adminSecret = cfg.InternalAPISecret
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
	if b.handleCommand(ctx, msg) {
		return
	}

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
		reply := "Could not register your prediction. Please try again."
		var apiErr *APIError
		if errors.As(err, &apiErr) {
			reply = apiErr.UserMessage()
		}
		_ = b.telegram.SendMessage(
			ctx,
			msg.Chat.ID,
			reply,
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
		if !isCommandMessage(msg.Text) {
			return
		}
	}

	if b.handleCommand(ctx, msg) {
		return
	}

	_ = b.telegram.SendMessage(
		ctx,
		msg.Chat.ID,
		startMessage(b.isAdminUser(msg.From.ID)),
		0,
	)
}

func (b *Bot) handleCommand(ctx context.Context, msg *Message) bool {
	command, args, ok := parseCommand(msg.Text)
	if !ok {
		return false
	}

	switch command {
	case "/start":
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, startMessage(b.isAdminUser(msg.From.ID)), replyIDForChat(msg))
		return true
	case "/help":
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, helpMessage(b.isAdminUser(msg.From.ID)), replyIDForChat(msg))
		return true
	case "/my_stats":
		if !b.api.HasAdminSecret() {
			_ = b.telegram.SendMessage(ctx, msg.Chat.ID, "User stats are not configured yet. Set INTERNAL_API_SECRET in the bot and webapp services.", replyIDForChat(msg))
			return true
		}
		stats, err := b.api.GetMyStats("telegram", strconv.FormatInt(msg.From.ID, 10))
		if err != nil {
			b.replyAPIError(ctx, msg, err)
			return true
		}
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, formatMyStatsMessage(stats, msg.From.ID), replyIDForChat(msg))
		return true
	case "/start_prediction":
		if !b.requireAdmin(ctx, msg) || !b.requireAdminAPI(ctx, msg) {
			return true
		}
		minutes, err := strconv.Atoi(strings.TrimSpace(args))
		if err != nil || minutes < 1 || minutes > 720 {
			_ = b.telegram.SendMessage(ctx, msg.Chat.ID, "Usage: /start_prediction <minutes> (1-720)", replyIDForChat(msg))
			return true
		}
		resp, err := b.api.StartPredictionRound(minutes)
		if err != nil {
			b.replyAPIError(ctx, msg, err)
			return true
		}
		reply := fmt.Sprintf(
			"Started round #%d for %d minutes.\nTarget: %02d:00 %s on %s\nCloses at: %s UTC",
			resp.RoundID,
			resp.Minutes,
			resp.TargetHour,
			timeZoneLabel(resp.TargetTimeZone),
			resp.QuestionDate,
			formatUTC(resp.CloseAt),
		)
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, reply, replyIDForChat(msg))
		return true
	case "/show_balance_stats":
		if !b.requireAdmin(ctx, msg) || !b.requireAdminAPI(ctx, msg) {
			return true
		}
		stats, err := b.api.GetBalanceStats()
		if err != nil {
			b.replyAPIError(ctx, msg, err)
			return true
		}
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, formatBalanceStatsMessage(stats), replyIDForChat(msg))
		return true
	case "/show_user_stats":
		if !b.requireAdmin(ctx, msg) || !b.requireAdminAPI(ctx, msg) {
			return true
		}
		rows, err := b.api.GetUserStats()
		if err != nil {
			b.replyAPIError(ctx, msg, err)
			return true
		}
		b.sendChunkedMessages(ctx, msg.Chat.ID, formatUserStatsMessages(rows), replyIDForChat(msg))
		return true
	default:
		return false
	}
}

func (b *Bot) handleRedisEvent(channel string, payload map[string]interface{}) {
	ctx := context.Background()

	switch {
	case strings.HasSuffix(channel, "prediction:open"):
		questionDate, _ := payload["question_date"].(string)
		targetHour, _ := payload["target_hour"].(float64)
		targetTimeZone, _ := payload["target_timezone"].(string)
		minSats, _ := payload["min_sats"].(float64)
		maxSats, _ := payload["max_sats"].(float64)
		msg := formatPredictionOpenMessage(
			questionDate,
			int(targetHour),
			targetTimeZone,
			intOrDefault(minSats, b.cfg.MinSats),
			intOrDefault(maxSats, b.cfg.MaxSats),
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
		stats := &BalanceStatsResponse{}
		if value, ok := payload["round_id"].(float64); ok {
			stats.RoundID = int(value)
		}
		if value, ok := payload["question_date"].(string); ok {
			stats.QuestionDate = value
		}
		if value, ok := payload["target_hour"].(float64); ok {
			stats.TargetHour = int(value)
		}
		if value, ok := payload["participant_count"].(float64); ok {
			stats.ParticipantCount = int(value)
		}
		if value, ok := payload["paid_count"].(float64); ok {
			stats.PaidCount = int(value)
		}
		if value, ok := payload["total_sats"].(float64); ok {
			stats.TotalSats = int(value)
		}
		if value, ok := payload["hours_to_target"].(float64); ok {
			stats.HoursToTarget = int(value)
		}
		_ = b.telegram.SendMessage(ctx, b.cfg.GroupChatID, formatBalanceStatsMessage(stats), 0)

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

func timeZoneLabel(value string) string {
	if value == "" {
		return "UTC"
	}
	return strings.ReplaceAll(value, "_", " ")
}

func isCommandMessage(text string) bool {
	return strings.HasPrefix(strings.TrimSpace(text), "/")
}

func parseCommand(text string) (string, string, bool) {
	trimmed := strings.TrimSpace(text)
	if !strings.HasPrefix(trimmed, "/") {
		return "", "", false
	}

	parts := strings.Fields(trimmed)
	command := strings.ToLower(parts[0])
	if at := strings.Index(command, "@"); at >= 0 {
		command = command[:at]
	}
	args := ""
	if len(parts) > 1 {
		args = strings.Join(parts[1:], " ")
	}
	return command, args, true
}

func (b *Bot) isAdminUser(userID int64) bool {
	_, ok := b.cfg.AdminUserIDs[userID]
	return ok
}

func (b *Bot) requireAdmin(ctx context.Context, msg *Message) bool {
	if b.isAdminUser(msg.From.ID) {
		return true
	}
	_ = b.telegram.SendMessage(ctx, msg.Chat.ID, "This command is only available to configured Telegram admins.", replyIDForChat(msg))
	return false
}

func (b *Bot) requireAdminAPI(ctx context.Context, msg *Message) bool {
	if b.api.HasAdminSecret() {
		return true
	}
	_ = b.telegram.SendMessage(ctx, msg.Chat.ID, "Admin commands are not configured. Set INTERNAL_API_SECRET in the bot and webapp services.", replyIDForChat(msg))
	return false
}

func (b *Bot) replyAPIError(ctx context.Context, msg *Message, err error) {
	reply := "Request failed. Please try again."
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		reply = apiErr.UserMessage()
	}
	_ = b.telegram.SendMessage(ctx, msg.Chat.ID, reply, replyIDForChat(msg))
}

func (b *Bot) sendChunkedMessages(ctx context.Context, chatID int64, chunks []string, replyToMessageID int) {
	for i, chunk := range chunks {
		replyTo := 0
		if i == 0 {
			replyTo = replyToMessageID
		}
		_ = b.telegram.SendMessage(ctx, chatID, chunk, replyTo)
	}
}

func replyIDForChat(msg *Message) int {
	if msg.Chat.Type == "private" {
		return 0
	}
	return msg.MessageID
}

func startMessage(includeAdmin bool) string {
	text := "Predictions are submitted in the group as '<price> <sats>'. If you had a pending invoice, it will appear here automatically.\n\nUser commands:\n/help\n/my_stats"
	if !includeAdmin {
		return text
	}
	return text + "\n\nAdmin commands:\n/start_prediction <minutes>\n/show_balance_stats\n/show_user_stats"
}

func helpMessage(includeAdmin bool) string {
	text := "Cassandrina bot help\n\nHow it works:\n1. Wait for the prediction window to open in the group.\n2. Submit your prediction in the group as: <price> <sats>\n3. The bot sends you a Lightning invoice in private.\n4. Pay the invoice before it expires.\n5. Only paid predictions count toward the round.\n6. Use /my_stats in private chat to see your stats and Telegram ID.\n\nUser commands:\n/help\n/my_stats\n/start"
	if !includeAdmin {
		return text
	}
	return text + "\n\nAdmin commands:\n/start_prediction <minutes>\n/show_balance_stats\n/show_user_stats"
}

func formatPredictionOpenMessage(questionDate string, targetHour int, targetTimeZone string, minSats int, maxSats int) string {
	dateLabel := "today"
	if strings.TrimSpace(questionDate) != "" {
		dateLabel = "on " + questionDate
	}
	return fmt.Sprintf(
		"Daily BTC Prediction\n\nWhat will BTC's price be at %02d:00 %s %s?\n\nReply with: <price> <sats> (example: 95000 500)\nMin: %d sats | Max: %d sats",
		targetHour,
		timeZoneLabel(targetTimeZone),
		dateLabel,
		minSats,
		maxSats,
	)
}

func formatBalanceStatsMessage(stats *BalanceStatsResponse) string {
	if stats == nil {
		return "No balance stats available."
	}
	header := fmt.Sprintf("%d-hour portfolio update", stats.HoursToTarget)
	if stats.QuestionDate != "" {
		header = header + fmt.Sprintf("\n\nRound %d · %s @ %02d:00", stats.RoundID, stats.QuestionDate, stats.TargetHour)
	}
	return fmt.Sprintf(
		"%s\n\nParticipants: %d\nPaid: %d\nTotal sats: %d",
		header,
		stats.ParticipantCount,
		stats.PaidCount,
		stats.TotalSats,
	)
}

func formatUserStatsMessages(rows []UserStatsRow) []string {
	if len(rows) == 0 {
		return []string{"User stats\n\nNo users yet."}
	}

	chunks := make([]string, 0, 1)
	current := "User stats"
	for i, row := range rows {
		entry := fmt.Sprintf(
			"\n\n%d. %s\nAcc %.1f%% | Cong %.1f%%\nBal %s | PnL %s\nPredictions %d",
			i+1,
			row.DisplayName,
			row.Accuracy,
			row.Congruency,
			formatSats(row.BalanceSats),
			formatSignedSats(row.ProfitSats),
			row.TotalPredictions,
		)
		if len(current)+len(entry) > 3500 {
			chunks = append(chunks, current)
			current = "User stats (cont.)" + entry
			continue
		}
		current += entry
	}
	chunks = append(chunks, current)
	return chunks
}

func formatMyStatsMessage(stats *MyStatsResponse, telegramUserID int64) string {
	if stats == nil {
		return "No stats available."
	}
	internalUserID := "not registered yet"
	if stats.UserID != nil {
		internalUserID = strconv.Itoa(*stats.UserID)
	}
	return fmt.Sprintf(
		"My stats\n\nName: %s\nTelegram ID: %d\nInternal user ID: %s\nAccuracy: %.1f%%\nCongruency: %.1f%%\nBalance: %s\nProfit: %s\nPredictions: %d",
		stats.DisplayName,
		telegramUserID,
		internalUserID,
		stats.Accuracy,
		stats.Congruency,
		formatSats(stats.BalanceSats),
		formatSignedSats(stats.ProfitSats),
		stats.TotalPredictions,
	)
}

func formatUTC(value string) string {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return value
	}
	return parsed.UTC().Format("2006-01-02 15:04")
}

func formatSats(value int) string {
	return fmt.Sprintf("%s sats", formatInt(value))
}

func formatSignedSats(value int) string {
	sign := ""
	if value > 0 {
		sign = "+"
	}
	return fmt.Sprintf("%s%s sats", sign, formatInt(value))
}

func formatInt(value int) string {
	negative := value < 0
	if negative {
		value = -value
	}

	digits := strconv.Itoa(value)
	if len(digits) <= 3 {
		if negative {
			return "-" + digits
		}
		return digits
	}

	var builder strings.Builder
	if negative {
		builder.WriteByte('-')
	}
	remainder := len(digits) % 3
	if remainder > 0 {
		builder.WriteString(digits[:remainder])
		if len(digits) > remainder {
			builder.WriteByte(',')
		}
	}
	for i := remainder; i < len(digits); i += 3 {
		builder.WriteString(digits[i : i+3])
		if i+3 < len(digits) {
			builder.WriteByte(',')
		}
	}
	return builder.String()
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
