package plugin

import (
	"context"
	"errors"
	"fmt"
	"html"
	"log"
	"math/rand"
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

var wisePhrases = []string{
	"The market humbles quickly, so stay humble first.",
	"Patience is also a position.",
	"Clarity grows when noise is allowed to pass.",
	"Discipline beats excitement over a long enough horizon.",
	"A calm mind sees more than a rushed one.",
}

type outboundTelegramMessage struct {
	Text      string
	ParseMode string
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
	if err := b.telegram.SyncCommands(ctx); err != nil {
		log.Printf("[telegram] setMyCommands failed: %v", err)
	}

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

	if looksLikePredictionMessage(msg.Text) {
		_ = b.telegram.SendMessage(
			ctx,
			msg.Chat.ID,
			groupPrivateChatPrompt(b.telegram.DeepLink(ctx)),
			msg.MessageID,
		)
	}
}

func (b *Bot) handlePrivateMessage(ctx context.Context, msg *Message) {
	pendingInvoice, ok := b.pullPendingInvoice(msg.Chat.ID)
	if ok {
		_ = b.telegram.SendHTMLMessage(ctx, msg.Chat.ID, pendingInvoice, 0)
		if !isCommandMessage(msg.Text) {
			return
		}
	}

	if b.handleCommand(ctx, msg) {
		return
	}

	pred, err := ParsePrediction(msg.Text, b.cfg.MinSats, b.cfg.MaxSats)
	if err == nil {
		b.submitPrediction(ctx, msg, pred)
		return
	}

	_ = b.telegram.SendMessage(
		ctx,
		msg.Chat.ID,
		startMessage(b.isAdminUser(msg.From.ID)),
		0,
	)
}

func (b *Bot) submitPrediction(ctx context.Context, msg *Message, pred *Prediction) {
	senderID := strconv.FormatInt(msg.From.ID, 10)
	displayName := telegramDisplayName(msg.From)
	groupChatID, groupName := b.predictionGroupMetadata(ctx)

	resp, err := b.api.CreatePrediction(PredictionRequest{
		Platform:            "telegram",
		PlatformUserID:      senderID,
		DisplayName:         displayName,
		TelegramGroupChatID: groupChatID,
		TelegramGroupName:   groupName,
		PredictedLowPrice:   pred.PredictedLowPrice,
		PredictedHighPrice:  pred.PredictedHighPrice,
		SatsAmount:          pred.SatsAmount,
	})
	if err != nil {
		log.Printf("[bot] failed to create prediction for %s: %v", senderID, err)
		reply := "Could not register your prediction. Please try again."
		var apiErr *APIError
		if errors.As(err, &apiErr) {
			reply = apiErr.UserMessage()
		}
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, reply, replyIDForChat(msg))
		return
	}

	invoiceMessage := formatPredictionInvoiceMessage(
		pred.PredictedLowPrice,
		pred.PredictedHighPrice,
		pred.SatsAmount,
		resp.LightningInvoice,
	)
	if err := b.sendOutgoingMessage(ctx, msg.From.ID, invoiceMessage, 0); err != nil {
		log.Printf("[bot] failed to DM %s: %v", senderID, err)
		b.storePendingInvoice(msg.From.ID, invoiceMessage.Text)

		startLink := b.telegram.DeepLink(ctx)
		reply := "I couldn't DM your invoice yet. Start a private chat with this bot and send /start, then I'll deliver the pending invoice."
		if startLink != "" {
			reply = "I couldn't DM your invoice yet. Open " + startLink + " and send /start, then I'll deliver the pending invoice."
		}
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, reply, replyIDForChat(msg))
	}
}

func (b *Bot) sendOutgoingMessage(
	ctx context.Context,
	chatID int64,
	message outboundTelegramMessage,
	replyToMessageID int,
) error {
	if message.ParseMode == "HTML" {
		return b.telegram.SendHTMLMessage(ctx, chatID, message.Text, replyToMessageID)
	}
	return b.telegram.SendMessage(ctx, chatID, message.Text, replyToMessageID)
}

func (b *Bot) handleInvoicePaidEvent(ctx context.Context, payload map[string]interface{}) {
	if strings.TrimSpace(asString(payload["platform"])) != "telegram" {
		return
	}
	chatID, err := strconv.ParseInt(strings.TrimSpace(asString(payload["platform_user_id"])), 10, 64)
	if err != nil || chatID == 0 {
		return
	}
	_ = b.telegram.SendMessage(ctx, chatID, formatInvoicePaidMessage(payload), 0)
}

func (b *Bot) predictionGroupMetadata(ctx context.Context) (string, string) {
	chatID := strconv.FormatInt(b.cfg.GroupChatID, 10)
	groupName := defaultTelegramGroupName(b.cfg.GroupChatID)

	if b.telegram == nil {
		return chatID, groupName
	}

	title, err := b.telegram.GetChatTitle(ctx, b.cfg.GroupChatID)
	if err != nil {
		log.Printf("[telegram] getChat title failed: %v", err)
		return chatID, groupName
	}
	if strings.TrimSpace(title) != "" {
		groupName = strings.TrimSpace(title)
	}

	return chatID, groupName
}

func (b *Bot) handleSettlementEvent(ctx context.Context, status string, payload map[string]interface{}) {
	participants := asObjectSlice(payload["participants"])
	_ = b.telegram.SendMessage(
		ctx,
		b.cfg.GroupChatID,
		formatSettlementMessage(
			status,
			intOrDefault(asFloat(payload["pnl_sats"]), 0),
			asFloat(payload["actual_low_price"]),
			asFloat(payload["actual_high_price"]),
			asFloat(payload["actual_price"]),
			participants,
			asObjectMap(payload["bot_summary"]),
		),
		0,
	)

	for _, participant := range participants {
		if strings.TrimSpace(asString(participant["platform"])) != "telegram" {
			continue
		}
		chatID, err := strconv.ParseInt(strings.TrimSpace(asString(participant["platform_user_id"])), 10, 64)
		if err != nil {
			continue
		}
		_ = b.telegram.SendMessage(ctx, chatID, formatParticipantSettlementDM(participant), 0)
	}
}

func (b *Bot) handleCommand(ctx context.Context, msg *Message) bool {
	command, args, ok := parseCommand(msg.Text)
	if !ok {
		return false
	}

	switch command {
	case "/start":
		reply := startMessage(b.isAdminUser(msg.From.ID))
		if msg.Chat.Type != "private" {
			reply = groupPrivateChatPrompt(b.telegram.DeepLink(ctx))
		}
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, reply, replyIDForChat(msg))
		return true
	case "/help":
		reply := helpMessage(b.isAdminUser(msg.From.ID))
		if msg.Chat.Type != "private" {
			reply = groupHelpMessage(b.telegram.DeepLink(ctx))
		}
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, reply, replyIDForChat(msg))
		return true
	case "/health":
		health, err := b.api.GetHealth()
		if err != nil {
			_ = b.telegram.SendMessage(ctx, msg.Chat.ID, formatHealthErrorMessage(err), replyIDForChat(msg))
			return true
		}
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, formatHealthMessage(health, b.api.HasAdminSecret()), replyIDForChat(msg))
		return true
	case "/status":
		_ = b.telegram.SendMessage(
			ctx,
			msg.Chat.ID,
			formatStatusMessage(b.isAdminUser(msg.From.ID), b.api.HasAdminSecret(), msg.Chat.Type == "private"),
			replyIDForChat(msg),
		)
		return true
	case "/prediction_status":
		status, err := b.api.GetPredictionStatus()
		if err != nil {
			b.replyAPIError(ctx, msg, err)
			return true
		}
		b.sendChunkedMessages(ctx, msg.Chat.ID, formatPredictionStatusMessages(status), replyIDForChat(msg))
		return true
	case "/position_status":
		status, err := b.api.GetPositionStatus()
		if err != nil {
			b.replyAPIError(ctx, msg, err)
			return true
		}
		_ = b.telegram.SendMessage(ctx, msg.Chat.ID, formatPositionStatusMessage(status), replyIDForChat(msg))
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
			"Started round #%d for %d minutes.\nTarget: %02d:00 %s on %s\nCloses at: %s",
			resp.RoundID,
			resp.Minutes,
			resp.TargetHour,
			timeZoneLabel(resp.TargetTimeZone),
			resp.QuestionDate,
			formatLocalTime(resp.CloseAt),
		)
		if resp.ReplacedRoundID != nil {
			reply = fmt.Sprintf("Replaced round #%d.\n\n%s", *resp.ReplacedRoundID, reply)
		}
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
	case "/show_group_stats":
		if !b.requireAdmin(ctx, msg) || !b.requireAdminAPI(ctx, msg) {
			return true
		}
		rows, err := b.api.GetGroupStats()
		if err != nil {
			b.replyAPIError(ctx, msg, err)
			return true
		}
		b.sendChunkedMessages(ctx, msg.Chat.ID, formatGroupStatsMessages(rows), replyIDForChat(msg))
		return true
	case "/send_polymarket_recap":
		if !b.requireAdmin(ctx, msg) || !b.requireAdminAPI(ctx, msg) {
			return true
		}
		_, err := b.api.TriggerPolymarketRecap()
		if err != nil {
			b.replyAPIError(ctx, msg, err)
			return true
		}
		_ = b.telegram.SendMessage(
			ctx,
			msg.Chat.ID,
			"Requested a Polymarket BTC recap. If the trading bot is running, it should post the recap to the group shortly.",
			replyIDForChat(msg),
		)
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
		closeAt, _ := payload["close_at"].(string)
		minSats, _ := payload["min_sats"].(float64)
		maxSats, _ := payload["max_sats"].(float64)
		msg := formatPredictionOpenMessage(
			questionDate,
			int(targetHour),
			targetTimeZone,
			closeAt,
			intOrDefault(minSats, b.cfg.MinSats),
			intOrDefault(maxSats, b.cfg.MaxSats),
			b.telegram.DeepLink(ctx),
		)
		_ = b.telegram.SendMessage(ctx, b.cfg.GroupChatID, msg, 0)

	case strings.HasSuffix(channel, "prediction:close"):
		closeReason, _ := payload["close_reason"].(string)
		_ = b.telegram.SendMessage(
			ctx,
			b.cfg.GroupChatID,
			formatPredictionCloseMessage(
				closeReason,
				asObjectSlice(payload["participants"]),
				asObjectMap(payload["trade_summary"]),
			),
			0,
		)

	case strings.HasSuffix(channel, "invoice:paid"):
		b.handleInvoicePaidEvent(ctx, payload)

	case strings.HasSuffix(channel, "trade:opened"):
		return

	case strings.HasSuffix(channel, "trade:closed"):
		b.handleSettlementEvent(ctx, "closed", payload)

	case strings.HasSuffix(channel, "trade:liquidated"):
		b.handleSettlementEvent(ctx, "liquidated", payload)

	case strings.HasSuffix(channel, "stats:8h"):
		return

	case strings.HasSuffix(channel, "weekly:vote"):
		_ = b.telegram.SendMessage(
			ctx,
			b.cfg.GroupChatID,
			"Weekly strategy vote\n\nWhich risk strategy for next week?\nA - Aggressive (20x-40x futures)\nB - Moderate (up to 20x futures)\nC - Grid (neutral)\nD - Safe (spot, 10% TP)\nE - Conservative (spot, 2% TP)\n\nReply with A, B, C, D, or E.",
			0,
		)

	case strings.HasSuffix(channel, "polymarket:bitcoin:recap"):
		b.sendChunkedMessages(
			ctx,
			b.cfg.GroupChatID,
			formatPolymarketBitcoinRecapMessages(payload),
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
		return message, true
	}
	return "", false
}

func intOrDefault(value float64, fallback int) int {
	if value == 0 {
		return fallback
	}
	return int(value)
}

func asFloat(value interface{}) float64 {
	parsed, _ := value.(float64)
	return parsed
}

func asString(value interface{}) string {
	parsed, _ := value.(string)
	return parsed
}

func asObjectMap(value interface{}) map[string]interface{} {
	parsed, _ := value.(map[string]interface{})
	return parsed
}

func asObjectSlice(value interface{}) []map[string]interface{} {
	switch typed := value.(type) {
	case []map[string]interface{}:
		return typed
	case []interface{}:
		items := make([]map[string]interface{}, 0, len(typed))
		for _, item := range typed {
			if parsed, ok := item.(map[string]interface{}); ok {
				items = append(items, parsed)
			}
		}
		return items
	default:
		return nil
	}
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

func looksLikePredictionMessage(text string) bool {
	return len(strings.Fields(strings.TrimSpace(text))) == 3
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
	text := "Send your prediction to Cassandrina here in private chat using:\n<lowest BTC price until 20:00 CET> <highest BTC price until 20:00 CET> <sats>\n\nExample:\n82000 84500 3000\n\nCassandrina will reply here with your Lightning invoice. If you had a pending invoice, it will appear here automatically.\n\nUser commands:\n/start\n/help\n/my_stats\n/health\n/status\n/prediction_status\n/position_status"
	if !includeAdmin {
		return text
	}
	return text + "\n\nAdmin commands:\n/start_prediction <minutes>\n/show_balance_stats\n/show_user_stats\n/show_group_stats\n/send_polymarket_recap"
}

func helpMessage(includeAdmin bool) string {
	text := "Cassandrina bot help\n\nHow it works:\n1. At 08:00 CET Cassandrina posts in the group that the prediction window is open.\n2. Send your prediction to Cassandrina in private as: <lowest> <highest> <sats>\n3. Example: 82000 84500 3000\n4. Cassandrina replies with a Lightning invoice in private.\n5. Pay the invoice before the window closes.\n6. When the window closes, the group gets the confirmed predictions plus the market position summary.\n7. At 20:00 CET Cassandrina settles the position, posts the result in the group, and sends each participant a private balance update.\n\nUser commands:\n/start\n/help\n/my_stats\n/health\n/status\n/prediction_status\n/position_status"
	if !includeAdmin {
		return text
	}
	return text + "\n\nAdmin commands:\n/start_prediction <minutes>\n/show_balance_stats\n/show_user_stats\n/show_group_stats\n/send_polymarket_recap"
}

func formatHealthMessage(health *HealthResponse, hasAdminAPI bool) string {
	status := "unknown"
	if health != nil && strings.TrimSpace(health.Status) != "" {
		status = health.Status
	}

	adminStatus := "not configured"
	if hasAdminAPI {
		adminStatus = "configured"
	}

	return fmt.Sprintf(
		"Cassandrina health\n\nBot: ok\nWebapp: %s\nAdmin API: %s",
		status,
		adminStatus,
	)
}

func formatHealthErrorMessage(err error) string {
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.StatusCode > 0 {
		return fmt.Sprintf("Cassandrina health check failed\n\nWebapp returned HTTP %d.", apiErr.StatusCode)
	}
	return "Cassandrina health check failed\n\nThe bot could not reach the webapp."
}

func formatStatusMessage(isAdmin bool, hasAdminAPI bool, isPrivateChat bool) string {
	role := "user"
	if isAdmin {
		role = "admin"
	}

	adminAPI := "not configured"
	if hasAdminAPI {
		adminAPI = "configured"
	}

	chatType := "group"
	if isPrivateChat {
		chatType = "private"
	}

	return fmt.Sprintf(
		"Cassandrina status\n\nBot: running\nRole: %s\nChat: %s\nAdmin API: %s",
		role,
		chatType,
		adminAPI,
	)
}

func formatPredictionStatusMessages(status *PredictionStatusResponse) []string {
	if status == nil || !status.HasRound || status.RoundID == nil {
		return []string{"Prediction status\n\nNo prediction round has been opened yet."}
	}

	lines := []string{
		"Prediction status",
		"",
		fmt.Sprintf("Round: #%d", *status.RoundID),
		fmt.Sprintf("Status: %s", status.Status),
		fmt.Sprintf(
			"Target: %02d:00 %s on %s",
			status.TargetHour,
			timeZoneLabel(status.TargetTimeZone),
			status.QuestionDate,
		),
	}
	if strings.TrimSpace(status.OpenAt) != "" {
		lines = append(lines, fmt.Sprintf("Opened: %s", formatLocalTime(status.OpenAt)))
	}
	if strings.TrimSpace(status.CloseAt) != "" {
		closeLabel := "Closed"
		if status.Status == "open" {
			closeLabel = "Closes"
		}
		lines = append(lines, fmt.Sprintf("%s: %s", closeLabel, formatLocalTime(status.CloseAt)))
	}

	lines = append(
		lines,
		"",
		fmt.Sprintf("Participants: %d", status.ParticipantCount),
		fmt.Sprintf("Confirmed: %d", status.ConfirmedCount),
		"",
		"Predictions shown here never include price ranges or sats amounts.",
	)

	if len(status.Participants) == 0 {
		lines = append(lines, "", "No predictions submitted yet.")
		return []string{strings.Join(lines, "\n")}
	}

	chunks := []string{strings.Join(lines, "\n")}
	current := "Participants"
	for i, participant := range status.Participants {
		state := "invoice pending"
		if participant.Paid {
			state = "confirmed"
		}
		entry := fmt.Sprintf("\n\n%d. %s\nStatus: %s", i+1, participant.DisplayName, state)
		if len(current)+len(entry) > 3500 {
			chunks = append(chunks, current)
			current = "Participants (cont.)" + entry
			continue
		}
		current += entry
	}
	chunks = append(chunks, current)
	return chunks
}

func formatPredictionOpenMessage(questionDate string, targetHour int, targetTimeZone, closeAt string, minSats int, maxSats int, startLink string) string {
	dateLabel := "today"
	if strings.TrimSpace(questionDate) != "" {
		dateLabel = "on " + questionDate
	}
	closeLabel := closeAt
	if strings.TrimSpace(closeAt) != "" {
		closeLabel = formatLocalTime(closeAt)
	}
	message := fmt.Sprintf(
		"Prediction window is open\n\nCassandrina is collecting private BTC predictions for %02d:00 %s %s.\nWindow closes at: %s\n\nSend Cassandrina a private message in this format:\n<lowest BTC price until 20:00 CET> <highest BTC price until 20:00 CET> <sats>\nExample: 82000 84500 3000\n\nMin: %d sats | Max: %d sats",
		targetHour,
		timeZoneLabel(targetTimeZone),
		dateLabel,
		closeLabel,
		minSats,
		maxSats,
	)
	if strings.TrimSpace(startLink) == "" {
		return message
	}
	return message + "\n\nOpen a private chat: " + strings.TrimSpace(startLink)
}

func formatPredictionCloseMessage(closeReason string, participants []map[string]interface{}, tradeSummary map[string]interface{}) string {
	lines := []string{
		"Prediction window is closed",
		"",
		fmt.Sprintf("Reason: %s", closeReason),
		"",
		"Confirmed predictions:",
	}

	if len(participants) == 0 {
		lines = append(lines, "No paid predictions this round.")
	} else {
		for _, participant := range participants {
			lines = append(
				lines,
				fmt.Sprintf(
					"- %s: low $%.0f | high $%.0f | %d sats",
					asString(participant["display_name"]),
					asFloat(participant["predicted_low_price"]),
					asFloat(participant["predicted_high_price"]),
					intOrDefault(asFloat(participant["sats_amount"]), 0),
				),
			)
		}
	}

	if len(tradeSummary) > 0 {
		mode := "live"
		if dryRun, ok := tradeSummary["dry_run"].(bool); ok && dryRun {
			mode = "simulated"
		}
		lines = append(
			lines,
			"",
			fmt.Sprintf(
				"Cassandrina used $%.2f as the opening number and opened a %s position (%s).",
				asFloat(tradeSummary["target_price"]),
				strings.ToUpper(asString(tradeSummary["direction"])),
				mode,
			),
			fmt.Sprintf(
				"Consensus range: low $%.2f | high $%.2f",
				asFloat(tradeSummary["target_low_price"]),
				asFloat(tradeSummary["target_high_price"]),
			),
			fmt.Sprintf(
				"Entry: $%.2f | Confidence: %.1f%% | Strategy: %s",
				asFloat(tradeSummary["entry_price"]),
				asFloat(tradeSummary["confidence_score"])*100,
				asString(tradeSummary["strategy"]),
			),
		)
		if probability, ok := tradeSummary["polymarket_probability"].(float64); ok {
			polymarketLine := fmt.Sprintf("Polymarket: %.1f%%", probability*100)
			if source := strings.TrimSpace(asString(tradeSummary["polymarket_source"])); source != "" && source != "unavailable" {
				polymarketLine += fmt.Sprintf(" (%s)", source)
			}
			if influence, ok := tradeSummary["polymarket_influence_pct"].(float64); ok {
				polymarketLine += fmt.Sprintf(" | Influence: %.1f%%", influence)
			}
			lines = append(lines, polymarketLine)
		}
	}

	return strings.Join(lines, "\n")
}

func formatPolymarketBitcoinRecapMessages(payload map[string]interface{}) []string {
	lines := []string{
		"Polymarket BTC recap",
		"",
	}
	if snapshotAt := strings.TrimSpace(asString(payload["snapshot_at"])); snapshotAt != "" {
		lines = append(lines, fmt.Sprintf("Snapshot: %s", formatLocalTime(snapshotAt)))
	}
	lines = append(
		lines,
		fmt.Sprintf("Open BTC markets: %d", intOrDefault(asFloat(payload["market_count"]), 0)),
		fmt.Sprintf("Participants stored today: %d", intOrDefault(asFloat(payload["stored_participant_count"]), 0)),
		"",
		"Implied price prediction:",
	)

	pricePredictions := asObjectMap(payload["price_predictions"])
	lines = append(lines, formatPricePredictionLine("Day", asObjectMap(pricePredictions["day"])))
	lines = append(lines, formatPricePredictionLine("Week", asObjectMap(pricePredictions["week"])))
	lines = append(lines, formatPricePredictionLine("Month", asObjectMap(pricePredictions["month"])))

	markets := asObjectSlice(payload["markets"])
	if len(markets) == 0 {
		lines = append(lines, "", "No open BTC-related Polymarket markets found.")
		return []string{strings.Join(lines, "\n")}
	}

	chunks := []string{strings.Join(lines, "\n")}
	current := "Open markets"
	for index, market := range markets {
		entry := formatPolymarketMarketEntry(index+1, market)
		if len(current)+len(entry) > 3500 {
			chunks = append(chunks, current)
			current = "Open markets (cont.)" + entry
			continue
		}
		current += entry
	}
	chunks = append(chunks, current)
	return chunks
}

func formatPricePredictionLine(label string, prediction map[string]interface{}) string {
	if len(prediction) == 0 {
		return fmt.Sprintf("- %s: unavailable", label)
	}
	estimate := asFloat(prediction["estimated_price"])
	thresholdCount := intOrDefault(asFloat(prediction["threshold_market_count"]), 0)
	windowDays := intOrDefault(asFloat(prediction["window_days"]), 0)
	if estimate <= 0 || thresholdCount == 0 {
		return fmt.Sprintf("- %s: unavailable (%d threshold markets in the next %dd)", label, thresholdCount, windowDays)
	}
	return fmt.Sprintf(
		"- %s: %s from %d threshold markets in the next %dd",
		label,
		formatUSD(estimate),
		thresholdCount,
		windowDays,
	)
}

func formatPolymarketMarketEntry(rank int, market map[string]interface{}) string {
	lines := []string{
		"",
		"",
		fmt.Sprintf("%d. %s", rank, strings.TrimSpace(asString(market["question"]))),
	}
	if eventTitle := strings.TrimSpace(asString(market["event_title"])); eventTitle != "" {
		lines = append(lines, fmt.Sprintf("Event: %s", eventTitle))
	}
	if endDate := strings.TrimSpace(asString(market["end_date"])); endDate != "" {
		lines = append(lines, fmt.Sprintf("Ends: %s", formatLocalTime(endDate)))
	}

	outcomes := asObjectSlice(market["outcomes"])
	if len(outcomes) > 0 {
		parts := make([]string, 0, len(outcomes))
		for _, outcome := range outcomes {
			label := strings.TrimSpace(asString(outcome["label"]))
			price := asFloat(outcome["price"])
			if label == "" {
				continue
			}
			parts = append(parts, fmt.Sprintf("%s %.1f%%", label, price*100))
		}
		if len(parts) > 0 {
			lines = append(lines, "Outcomes: "+strings.Join(parts, " | "))
		}
	}

	stats := []string{
		fmt.Sprintf("24h vol %s", formatCompactUSD(asFloat(market["volume24hr"]))),
		fmt.Sprintf("liq %s", formatCompactUSD(asFloat(market["liquidity"]))),
		fmt.Sprintf("total vol %s", formatCompactUSD(asFloat(market["volume"]))),
	}
	lines = append(lines, "Stats: "+strings.Join(stats, " | "))

	lastTradePrice := asFloat(market["last_trade_price"])
	bestBid := asFloat(market["best_bid"])
	bestAsk := asFloat(market["best_ask"])
	if lastTradePrice > 0 || bestBid > 0 || bestAsk > 0 {
		lines = append(
			lines,
			fmt.Sprintf(
				"Market: last %.2f | bid %.2f | ask %.2f",
				lastTradePrice,
				bestBid,
				bestAsk,
			),
		)
	}

	participantCount := intOrDefault(asFloat(market["participant_count"]), 0)
	if participantCount > 0 {
		lines = append(lines, fmt.Sprintf("Tracked participants: %d", participantCount))
	}
	return strings.Join(lines, "\n")
}

func formatPositionStatusMessage(status *PositionStatusResponse) string {
	if status == nil {
		return "Position status\n\nNo position data is available."
	}

	switch status.Phase {
	case "open_position", "last_position":
		title := "Position status"
		if status.Phase == "last_position" && status.Status != "open" {
			title = "Latest position status"
		}
		lines := []string{
			title,
			"",
		}
		if status.TradeID != nil {
			lines = append(lines, fmt.Sprintf("Trade: #%d", *status.TradeID))
		}
		if status.RoundID != nil {
			lines = append(lines, fmt.Sprintf("Round: #%d", *status.RoundID))
		}
		lines = append(
			lines,
			fmt.Sprintf("Status: %s", status.Status),
			fmt.Sprintf(
				"Target: %02d:00 %s on %s",
				status.TargetHour,
				timeZoneLabel(status.TargetTimeZone),
				status.QuestionDate,
			),
			fmt.Sprintf("Direction: %s", strings.ToUpper(status.Direction)),
			fmt.Sprintf("Strategy: %s", status.Strategy),
			fmt.Sprintf("Opening number: $%.2f", status.TargetPrice),
			fmt.Sprintf("Entry: $%.2f", status.EntryPrice),
			fmt.Sprintf("Leverage: %dx", status.Leverage),
		)
		if strings.TrimSpace(status.OpenedAt) != "" {
			lines = append(lines, fmt.Sprintf("Opened: %s", formatLocalTime(status.OpenedAt)))
		}
		if strings.TrimSpace(status.ClosedAt) != "" {
			lines = append(lines, fmt.Sprintf("Closed: %s", formatLocalTime(status.ClosedAt)))
		}
		if status.PnLSats != nil {
			lines = append(lines, fmt.Sprintf("PnL: %s", formatSignedSats(*status.PnLSats)))
		}
		return strings.Join(lines, "\n")
	case "prediction_window_open":
		lines := []string{
			"Position status",
			"",
			"No position is open yet.",
			fmt.Sprintf(
				"Current round: %02d:00 %s on %s",
				status.TargetHour,
				timeZoneLabel(status.TargetTimeZone),
				status.QuestionDate,
			),
		}
		if strings.TrimSpace(status.CloseAt) != "" {
			lines = append(lines, fmt.Sprintf("Prediction window closes: %s", formatLocalTime(status.CloseAt)))
		}
		lines = append(lines, "Cassandrina opens the position after the prediction window closes.")
		return strings.Join(lines, "\n")
	case "awaiting_position":
		lines := []string{
			"Position status",
			"",
			"The prediction round is closed, but no position has been opened yet.",
		}
		if status.RoundID != nil {
			lines = append(lines, fmt.Sprintf("Round: #%d", *status.RoundID))
		}
		if strings.TrimSpace(status.CloseAt) != "" {
			lines = append(lines, fmt.Sprintf("Round closed: %s", formatLocalTime(status.CloseAt)))
		}
		return strings.Join(lines, "\n")
	default:
		return "Position status\n\nNo position has been opened yet."
	}
}

func formatSettlementMessage(
	status string,
	pnlSats int,
	actualLowPrice, actualHighPrice, actualPrice float64,
	participants []map[string]interface{},
	botSummary map[string]interface{},
) string {
	title := "Trade closed"
	if status == "liquidated" {
		title = "Trade liquidated"
	}
	lines := []string{
		title,
		"",
		fmt.Sprintf("Settlement price: $%.2f", actualPrice),
		fmt.Sprintf("Real day range: low $%.2f | high $%.2f", actualLowPrice, actualHighPrice),
		fmt.Sprintf("Round PnL: %s", formatSignedSats(pnlSats)),
	}
	if len(botSummary) > 0 {
		lines = append(
			lines,
			fmt.Sprintf(
				"Cassandrina range: low $%.2f | high $%.2f | avg error %.2f%%",
				asFloat(botSummary["predicted_low_price"]),
				asFloat(botSummary["predicted_high_price"]),
				asFloat(botSummary["range_error_pct"]),
			),
		)
	}
	lines = append(lines, "", "Prediction closeness:")
	for _, participant := range participants {
		lines = append(
			lines,
			fmt.Sprintf(
				"- %s: low $%.0f | high $%.0f | avg error %.2f%% | day PnL %s",
				asString(participant["display_name"]),
				asFloat(participant["predicted_low_price"]),
				asFloat(participant["predicted_high_price"]),
				asFloat(participant["range_error_pct"]),
				formatSignedSats(intOrDefault(asFloat(participant["delta_sats"]), 0)),
			),
		)
	}
	return strings.Join(lines, "\n")
}

func formatParticipantSettlementDM(participant map[string]interface{}) string {
	return fmt.Sprintf(
		"Round settled\n\nToday's PnL: %s\nCurrent balance: %s\n\n%s",
		formatSignedSats(intOrDefault(asFloat(participant["delta_sats"]), 0)),
		formatSats(intOrDefault(asFloat(participant["balance_sats"]), 0)),
		randomWisePhrase(),
	)
}

func formatPredictionInvoiceMessage(lowPrice, highPrice float64, satsAmount int, invoice string) outboundTelegramMessage {
	escapedInvoice := html.EscapeString(strings.TrimSpace(invoice))
	return outboundTelegramMessage{
		Text: fmt.Sprintf(
			"Your prediction is registered.\nLow by 20:00: $%.0f\nHigh by 20:00: $%.0f\nSats: %d\n\n<a href=\"lightning:%s\">Open in your Lightning wallet</a>\n\nLightning invoice:\n<code>%s</code>",
			lowPrice,
			highPrice,
			satsAmount,
			escapedInvoice,
			escapedInvoice,
		),
		ParseMode: "HTML",
	}
}

func formatInvoicePaidMessage(payload map[string]interface{}) string {
	groupName := strings.TrimSpace(asString(payload["telegram_group_name"]))
	if groupName != "" {
		return fmt.Sprintf(
			"Invoice paid and your prediction is confirmed.\n\nGroup: %s\nStake: %s",
			groupName,
			formatSats(intOrDefault(asFloat(payload["amount_sats"]), 0)),
		)
	}
	return fmt.Sprintf(
		"Invoice paid and your prediction is confirmed.\n\nStake: %s",
		formatSats(intOrDefault(asFloat(payload["amount_sats"]), 0)),
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
			"\n\n%d. %s\nAcc %s | Cong %s\nBal %s | PnL %s\nPredictions %d",
			i+1,
			row.DisplayName,
			formatScorePercent(row.Accuracy),
			formatScorePercent(row.Congruency),
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

func formatGroupStatsMessages(rows []GroupStatsRow) []string {
	if len(rows) == 0 {
		return []string{"Group stats\n\nNo Telegram groups tracked yet."}
	}

	chunks := make([]string, 0, 1)
	current := "Group stats"
	for i, row := range rows {
		entry := fmt.Sprintf(
			"\n\n%d. %s\nAvg acc %s | Avg cong %s\nMembers %d | Predictions %d\nBal %s | PnL %s",
			i+1,
			row.GroupName,
			formatScorePercent(row.AverageAccuracy),
			formatScorePercent(row.AverageCongruency),
			row.ParticipantCount,
			row.TotalPredictions,
			formatSats(row.BalanceSats),
			formatSignedSats(row.ProfitSats),
		)
		if len(current)+len(entry) > 3500 {
			chunks = append(chunks, current)
			current = "Group stats (cont.)" + entry
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
		"My stats\n\nName: %s\nTelegram ID: %d\nInternal user ID: %s\nAccuracy: %s\nCongruency: %s\nBalance: %s\nProfit: %s\nPredictions: %d",
		stats.DisplayName,
		telegramUserID,
		internalUserID,
		formatScorePercent(stats.Accuracy),
		formatScorePercent(stats.Congruency),
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

func formatLocalTime(value string) string {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return value
	}
	return parsed.Format("2006-01-02 15:04 MST")
}

func formatSats(value int) string {
	return fmt.Sprintf("%s sats", formatInt(value))
}

func formatScorePercent(score float64) string {
	return fmt.Sprintf("%.1f%%", score*100)
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

func formatUSD(value float64) string {
	return fmt.Sprintf("$%s", formatFloat(value, 0))
}

func formatCompactUSD(value float64) string {
	absValue := value
	if absValue < 0 {
		absValue = -absValue
	}
	switch {
	case absValue >= 1_000_000_000:
		return fmt.Sprintf("$%.2fB", value/1_000_000_000)
	case absValue >= 1_000_000:
		return fmt.Sprintf("$%.2fM", value/1_000_000)
	case absValue >= 1_000:
		return fmt.Sprintf("$%.1fK", value/1_000)
	default:
		return fmt.Sprintf("$%s", formatFloat(value, 0))
	}
}

func formatFloat(value float64, decimals int) string {
	formatted := strconv.FormatFloat(value, 'f', decimals, 64)
	negative := strings.HasPrefix(formatted, "-")
	if negative {
		formatted = formatted[1:]
	}
	parts := strings.SplitN(formatted, ".", 2)
	intPart, err := strconv.Atoi(parts[0])
	if err != nil {
		if negative {
			return "-" + formatted
		}
		return formatted
	}
	result := formatInt(intPart)
	if negative {
		result = "-" + result
	}
	if len(parts) == 2 && decimals > 0 {
		return result + "." + parts[1]
	}
	return result
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

func defaultTelegramGroupName(chatID int64) string {
	return fmt.Sprintf("Telegram group %d", chatID)
}

func groupPrivateChatPrompt(startLink string) string {
	message := "Send your prediction to Cassandrina in a private chat. Use:\n<lowest BTC price> <highest BTC price> <sats>"
	if strings.TrimSpace(startLink) == "" {
		return message
	}
	return message + "\n\nOpen private chat: " + strings.TrimSpace(startLink)
}

func groupHelpMessage(startLink string) string {
	message := "Cassandrina collects predictions in private chat, not in the group.\n\nSend:\n<lowest BTC price> <highest BTC price> <sats>\nExample: 82000 84500 3000"
	if strings.TrimSpace(startLink) == "" {
		return message
	}
	return message + "\n\nOpen private chat: " + strings.TrimSpace(startLink)
}

func randomWisePhrase() string {
	if len(wisePhrases) == 0 {
		return "Stay steady."
	}
	source := rand.NewSource(time.Now().UnixNano())
	return wisePhrases[rand.New(source).Intn(len(wisePhrases))]
}
