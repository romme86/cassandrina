package plugin

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type sentMessage struct {
	chatID           int64
	text             string
	parseMode        string
	replyToMessageID int
}

type fakeTelegramGateway struct {
	messages    []sentMessage
	sendError   error
	chatTitles  map[int64]string
	deepLinkURL string
}

func (f *fakeTelegramGateway) GetUpdates(context.Context, int, int) ([]Update, error) {
	return nil, nil
}

func (f *fakeTelegramGateway) SendMessage(_ context.Context, chatID int64, text string, replyToMessageID int) error {
	f.messages = append(f.messages, sentMessage{chatID: chatID, text: text, replyToMessageID: replyToMessageID})
	return f.sendError
}

func (f *fakeTelegramGateway) SendHTMLMessage(_ context.Context, chatID int64, html string, replyToMessageID int) error {
	f.messages = append(f.messages, sentMessage{
		chatID:           chatID,
		text:             html,
		parseMode:        "HTML",
		replyToMessageID: replyToMessageID,
	})
	return f.sendError
}

func (f *fakeTelegramGateway) GetChatTitle(_ context.Context, chatID int64) (string, error) {
	if f.chatTitles == nil {
		return "", nil
	}
	return f.chatTitles[chatID], nil
}

func (f *fakeTelegramGateway) DeepLink(context.Context) string {
	return f.deepLinkURL
}

func (f *fakeTelegramGateway) SyncCommands(context.Context) error {
	return nil
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestHandleRedisEventPredictionClose(t *testing.T) {
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{MinSats: 1000, MaxSats: 10000, GroupChatID: -42},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handleRedisEvent("cassandrina:prediction:close", map[string]interface{}{
		"paid_count":   float64(3),
		"total_sats":   float64(1500),
		"close_reason": "window_expired",
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 group message, got %d", len(gateway.messages))
	}
	if want := "Prediction window is closed"; !contains(gateway.messages[0].text, want) {
		t.Fatalf("message %q does not contain %q", gateway.messages[0].text, want)
	}
}

func TestHandleRedisEventPredictionCloseShowsSimulatedModeAndPolymarketDetails(t *testing.T) {
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{MinSats: 1000, MaxSats: 10000, GroupChatID: -42},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handleRedisEvent("cassandrina:prediction:close", map[string]interface{}{
		"close_reason": "paid_threshold",
		"participants": []map[string]interface{}{
			{
				"display_name":         "@seacode",
				"predicted_low_price":  66450.0,
				"predicted_high_price": 67360.0,
				"sats_amount":          3450.0,
			},
		},
		"trade_summary": map[string]interface{}{
			"direction":                "long",
			"target_low_price":         66450.0,
			"target_high_price":        67360.0,
			"target_price":             66905.0,
			"entry_price":              66837.87,
			"confidence_score":         0.381,
			"strategy":                 "D",
			"dry_run":                  true,
			"polymarket_probability":   0.5,
			"polymarket_source":        "probability",
			"polymarket_influence_pct": 23.1,
		},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 group message, got %d", len(gateway.messages))
	}
	if want := "opened a LONG position (simulated)"; !contains(gateway.messages[0].text, want) {
		t.Fatalf("message %q does not contain %q", gateway.messages[0].text, want)
	}
	if want := "Polymarket: 50.0% (probability) | Influence: 23.1%"; !contains(gateway.messages[0].text, want) {
		t.Fatalf("message %q does not contain %q", gateway.messages[0].text, want)
	}
}

func TestHandleRedisEventPredictionOpenIncludesConfiguredTimezone(t *testing.T) {
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{MinSats: 1000, MaxSats: 10000, GroupChatID: -42},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handleRedisEvent("cassandrina:prediction:open", map[string]interface{}{
		"target_hour":     float64(8),
		"target_timezone": "Europe/Rome",
		"min_sats":        float64(1000),
		"max_sats":        float64(10000),
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 group message, got %d", len(gateway.messages))
	}
	if want := "08:00 Europe/Rome"; !contains(gateway.messages[0].text, want) {
		t.Fatalf("message %q does not contain %q", gateway.messages[0].text, want)
	}
}

func TestHandleRedisEventPolymarketBitcoinRecap(t *testing.T) {
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{GroupChatID: -42},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handleRedisEvent("cassandrina:polymarket:bitcoin:recap", map[string]interface{}{
		"snapshot_at":              "2026-04-05T16:00:00Z",
		"market_count":             float64(1),
		"stored_participant_count": float64(12),
		"price_predictions": map[string]interface{}{
			"day": map[string]interface{}{
				"window_days":            float64(1),
				"threshold_market_count": float64(2),
				"estimated_price":        103000.0,
			},
			"week": map[string]interface{}{
				"window_days":            float64(7),
				"threshold_market_count": float64(3),
				"estimated_price":        107500.0,
			},
			"month": map[string]interface{}{
				"window_days":            float64(30),
				"threshold_market_count": float64(4),
				"estimated_price":        112000.0,
			},
		},
		"markets": []map[string]interface{}{
			{
				"question":          "Will Bitcoin be above $105,000 by April 5, 2026?",
				"end_date":          "2026-04-05T23:59:59Z",
				"participant_count": float64(12),
				"volume24hr":        float64(45000),
				"liquidity":         float64(125000),
				"volume":            float64(510000),
				"last_trade_price":  0.61,
				"best_bid":          0.60,
				"best_ask":          0.62,
				"outcomes": []map[string]interface{}{
					{"label": "Yes", "price": 0.61},
					{"label": "No", "price": 0.39},
				},
			},
		},
	})

	if len(gateway.messages) == 0 {
		t.Fatalf("expected recap messages to be sent")
	}
	if want := "Polymarket BTC recap"; !contains(gateway.messages[0].text, want) {
		t.Fatalf("message %q does not contain %q", gateway.messages[0].text, want)
	}
	if want := "Day: $103,000"; !contains(gateway.messages[0].text, want) {
		t.Fatalf("message %q does not contain %q", gateway.messages[0].text, want)
	}
	foundMarket := false
	for _, message := range gateway.messages {
		if contains(message.text, "Will Bitcoin be above $105,000 by April 5, 2026?") {
			foundMarket = true
			break
		}
	}
	if !foundMarket {
		t.Fatalf("expected a market entry in the recap messages")
	}
}

func TestHandleGroupMessageStoresPendingInvoiceWhenDMFails(t *testing.T) {
	gateway := &fakeTelegramGateway{sendError: errors.New("dm blocked"), deepLinkURL: "https://t.me/cassandrina_bot"}
	bot := &Bot{
		cfg:             &Config{MinSats: 1000, MaxSats: 10000, GroupChatID: -42},
		api:             &WebappClient{},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.storePendingInvoice(123, "pending")
	message, ok := bot.pullPendingInvoice(123)
	if !ok || message != "pending" {
		t.Fatalf("expected pending invoice to round-trip through the queue")
	}
}

func TestHandleGroupMessageRedirectsPredictionAttemptsToPrivateChat(t *testing.T) {
	gateway := &fakeTelegramGateway{deepLinkURL: "https://t.me/cassandrina_bot"}
	bot := &Bot{
		cfg:             &Config{MinSats: 1000, MaxSats: 10000, GroupChatID: -42},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handleGroupMessage(context.Background(), &Message{
		MessageID: 77,
		Text:      "93000 97000 500",
		Chat:      Chat{ID: -42, Type: "group"},
		From:      &TelegramUser{ID: 123, Username: "alice"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 group reply, got %d", len(gateway.messages))
	}
	if gateway.messages[0].chatID != -42 {
		t.Fatalf("expected reply in group chat, got %d", gateway.messages[0].chatID)
	}
	if gateway.messages[0].replyToMessageID != 77 {
		t.Fatalf("expected reply to original message, got %d", gateway.messages[0].replyToMessageID)
	}
	if !contains(gateway.messages[0].text, "private chat") {
		t.Fatalf("expected redirect to private chat, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "https://t.me/cassandrina_bot") {
		t.Fatalf("expected private chat link in redirect, got %q", gateway.messages[0].text)
	}
}

func TestGroupStartCommandIncludesPrivateChatLink(t *testing.T) {
	gateway := &fakeTelegramGateway{deepLinkURL: "https://t.me/cassandrina_bot"}
	bot := &Bot{
		cfg:             &Config{GroupChatID: -42},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handleGroupMessage(context.Background(), &Message{
		MessageID: 88,
		Text:      "/start",
		Chat:      Chat{ID: -42, Type: "group"},
		From:      &TelegramUser{ID: 123, Username: "alice"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 group reply, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "Open private chat") {
		t.Fatalf("expected private chat prompt, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "https://t.me/cassandrina_bot") {
		t.Fatalf("expected private chat link, got %q", gateway.messages[0].text)
	}
}

func TestHandleRedisEventPredictionOpenIncludesPrivateChatLink(t *testing.T) {
	gateway := &fakeTelegramGateway{deepLinkURL: "https://t.me/cassandrina_bot"}
	bot := &Bot{
		cfg:             &Config{MinSats: 1000, MaxSats: 10000, GroupChatID: -42},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handleRedisEvent("cassandrina:prediction:open", map[string]interface{}{
		"target_hour":     float64(8),
		"target_timezone": "Europe/Rome",
		"min_sats":        float64(1000),
		"max_sats":        float64(10000),
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 group message, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "Open a private chat: https://t.me/cassandrina_bot") {
		t.Fatalf("expected prediction open link, got %q", gateway.messages[0].text)
	}
}

func TestHandleRedisEventInvoicePaidSendsTelegramConfirmationDM(t *testing.T) {
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{GroupChatID: -42},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handleRedisEvent("cassandrina:invoice:paid", map[string]interface{}{
		"platform":            "telegram",
		"platform_user_id":    "123",
		"amount_sats":         float64(3000),
		"telegram_group_name": "Friends of BTC",
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 invoice confirmation DM, got %d", len(gateway.messages))
	}
	if gateway.messages[0].chatID != 123 {
		t.Fatalf("expected DM to Telegram user 123, got %d", gateway.messages[0].chatID)
	}
	if !contains(gateway.messages[0].text, "Invoice paid and your prediction is confirmed.") {
		t.Fatalf("expected confirmation text, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Group: Friends of BTC") {
		t.Fatalf("expected group name in confirmation, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Stake: 3,000 sats") {
		t.Fatalf("expected stake in confirmation, got %q", gateway.messages[0].text)
	}
}

func TestHandlePrivateMessageStartShowsAdminCommandsForAdmin(t *testing.T) {
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg: &Config{
			AdminUserIDs: map[int64]struct{}{123: {}},
		},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/start",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "admin"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 private reply, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "/start_prediction <minutes>") {
		t.Fatalf("expected admin help text, got %q", gateway.messages[0].text)
	}
}

func TestHelpCommandShowsUserInstructions(t *testing.T) {
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/help",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "user"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 help reply, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "How it works:") {
		t.Fatalf("expected usage section, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "/my_stats") {
		t.Fatalf("expected my_stats command in help, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "/health") {
		t.Fatalf("expected health command in help, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "/status") {
		t.Fatalf("expected status command in help, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "/prediction_status") {
		t.Fatalf("expected prediction_status command in help, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "/position_status") {
		t.Fatalf("expected position_status command in help, got %q", gateway.messages[0].text)
	}
	if contains(gateway.messages[0].text, "/start_prediction <minutes>") {
		t.Fatalf("did not expect admin commands for non-admin, got %q", gateway.messages[0].text)
	}
}

func TestHelpCommandShowsAdminCommandsForAdmin(t *testing.T) {
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg: &Config{
			AdminUserIDs: map[int64]struct{}{123: {}},
		},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/help",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "admin"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 help reply, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "/start_prediction <minutes>") {
		t.Fatalf("expected admin commands in help, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "/show_group_stats") {
		t.Fatalf("expected group stats command in help, got %q", gateway.messages[0].text)
	}
}

func TestHealthCommandUsesConfiguredWebappPath(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test/cassandrina")
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/cassandrina/api/health" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"status":"ok"}`)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/health",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "user"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 health reply, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "Webapp: ok") {
		t.Fatalf("expected health reply to include webapp status, got %q", gateway.messages[0].text)
	}
}

func TestStatusCommandShowsAdminRole(t *testing.T) {
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg: &Config{
			AdminUserIDs: map[int64]struct{}{123: {}},
		},
		api:             &WebappClient{adminSecret: "test-secret"},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/status",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "admin"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 status reply, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "Role: admin") {
		t.Fatalf("expected admin role in status reply, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Admin API: configured") {
		t.Fatalf("expected admin API status in reply, got %q", gateway.messages[0].text)
	}
}

func TestMyStatsCommandReturnsUserStatsAndIds(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test")
	client.adminSecret = "super-secret"
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/internal/users/stats" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("platform_user_id"); got != "123" {
			t.Fatalf("expected platform_user_id=123, got %q", got)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(
				`{"user_id":42,"display_name":"Alice","platform_user_id":"123","accuracy":0.615,"congruency":0.522,"balance_sats":1234,"profit_sats":234,"total_predictions":7}`,
			)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/my_stats",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "alice"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 my_stats reply, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "Telegram ID: 123") {
		t.Fatalf("expected telegram id in output, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Internal user ID: 42") {
		t.Fatalf("expected internal id in output, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Predictions: 7") {
		t.Fatalf("expected prediction count in output, got %q", gateway.messages[0].text)
	}
}

func TestMyStatsCommandShowsDefaultsForUnregisteredUser(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test")
	client.adminSecret = "super-secret"
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(
				`{"user_id":null,"display_name":"telegram-555","platform_user_id":"555","accuracy":50,"congruency":50,"balance_sats":0,"profit_sats":0,"total_predictions":0}`,
			)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/my_stats",
		Chat: Chat{ID: 555, Type: "private"},
		From: &TelegramUser{ID: 555, Username: "new-user"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 my_stats reply, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "Internal user ID: not registered yet") {
		t.Fatalf("expected placeholder internal id, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Predictions: 0") {
		t.Fatalf("expected zero prediction count, got %q", gateway.messages[0].text)
	}
}

func TestPredictionStatusCommandShowsParticipantsWithoutAmounts(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test")
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/predictions/status" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(
				`{"has_round":true,"round_id":12,"question_date":"2026-03-27","target_hour":20,"target_timezone":"Europe/Zurich","open_at":"2026-03-27T07:00:00Z","close_at":"2026-03-27T08:30:00Z","status":"open","participant_count":2,"confirmed_count":1,"participants":[{"display_name":"Alice","paid":true,"created_at":"2026-03-27T07:05:00Z","paid_at":"2026-03-27T07:06:00Z"},{"display_name":"Bob","paid":false,"created_at":"2026-03-27T07:10:00Z","paid_at":""}]}`,
			)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/prediction_status",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "user"},
	})

	if len(gateway.messages) != 2 {
		t.Fatalf("expected 2 prediction status messages, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "Round: #12") {
		t.Fatalf("expected round id in output, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Predictions shown here never include price ranges or sats amounts.") {
		t.Fatalf("expected privacy note in output, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[1].text, "1. Alice") || !contains(gateway.messages[1].text, "Status: confirmed") {
		t.Fatalf("expected confirmed participant in output, got %q", gateway.messages[1].text)
	}
	if !contains(gateway.messages[1].text, "2. Bob") || !contains(gateway.messages[1].text, "Status: invoice pending") {
		t.Fatalf("expected pending participant in output, got %q", gateway.messages[1].text)
	}
	if contains(gateway.messages[0].text, "82000") || contains(gateway.messages[1].text, "82000") {
		t.Fatalf("did not expect any prediction prices in output")
	}
}

func TestPositionStatusCommandShowsOpenPosition(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test")
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/position/status" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(
				`{"phase":"open_position","has_position":true,"trade_id":44,"round_id":12,"question_date":"2026-03-27","target_hour":20,"target_timezone":"Europe/Zurich","open_at":"","close_at":"","status":"open","strategy":"C","direction":"long","entry_price":87123.45,"target_price":87000,"leverage":3,"opened_at":"2026-03-27T08:35:00Z","closed_at":"","pnl_sats":null}`,
			)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/position_status",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "user"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 position status message, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "Trade: #44") {
		t.Fatalf("expected trade id in output, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Direction: LONG") {
		t.Fatalf("expected direction in output, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Strategy: C") {
		t.Fatalf("expected strategy in output, got %q", gateway.messages[0].text)
	}
}

func TestAdminStartPredictionCommandUsesInternalSecret(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test")
	client.adminSecret = "super-secret"
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/admin/predictions/start" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get(adminSecretHeader); got != "super-secret" {
			t.Fatalf("expected admin secret header, got %q", got)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(
				`{"round_id":12,"question_date":"2026-03-25","target_hour":20,"target_timezone":"Europe/Zurich","close_at":"2026-03-25T12:30:00Z","minutes":30}`,
			)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg: &Config{
			GroupChatID:  -42,
			AdminUserIDs: map[int64]struct{}{123: {}},
		},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/start_prediction 30",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "admin"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 admin reply, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "Started round #12 for 30 minutes.") {
		t.Fatalf("unexpected message %q", gateway.messages[0].text)
	}
}

func TestAdminStartPredictionCommandMentionsReplacedRound(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test")
	client.adminSecret = "super-secret"
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(
				`{"round_id":12,"replaced_round_id":7,"question_date":"2026-03-25","target_hour":20,"target_timezone":"Europe/Zurich","close_at":"2026-03-25T12:05:00Z","minutes":5}`,
			)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg: &Config{
			GroupChatID:  -42,
			AdminUserIDs: map[int64]struct{}{123: {}},
		},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/start_prediction 5",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "admin"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 admin reply, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "Replaced round #7.") {
		t.Fatalf("expected replaced-round message, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Started round #12 for 5 minutes.") {
		t.Fatalf("unexpected message %q", gateway.messages[0].text)
	}
}

func TestAdminShowUserStatsFormatsReadableMessage(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test")
	client.adminSecret = "super-secret"
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/admin/stats/users" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(`[
				{"id":1,"display_name":"Alice","accuracy":0.615,"congruency":0.522,"balance_sats":1234,"profit_sats":234,"total_predictions":7},
				{"id":2,"display_name":"Bob","accuracy":0.55,"congruency":0.49,"balance_sats":900,"profit_sats":-100,"total_predictions":4}
			]`)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg: &Config{
			AdminUserIDs: map[int64]struct{}{123: {}},
		},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/show_user_stats",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "admin"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 stats message, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "1. Alice") {
		t.Fatalf("expected Alice in stats output, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Bal 1,234 sats | PnL +234 sats") {
		t.Fatalf("expected formatted sats output, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "2. Bob") {
		t.Fatalf("expected Bob in stats output, got %q", gateway.messages[0].text)
	}
}

func TestAdminShowGroupStatsFormatsReadableMessage(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test")
	client.adminSecret = "super-secret"
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/admin/stats/groups" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(`[
				{"group_name":"Friends of BTC","telegram_group_chat_id":"-100123","average_accuracy":0.615,"average_congruency":0.522,"balance_sats":1234,"profit_sats":234,"total_predictions":7,"participant_count":3},
				{"group_name":"Weekend Traders","telegram_group_chat_id":"-100456","average_accuracy":0.55,"average_congruency":0.49,"balance_sats":900,"profit_sats":-100,"total_predictions":4,"participant_count":2}
			]`)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg: &Config{
			AdminUserIDs: map[int64]struct{}{123: {}},
		},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/show_group_stats",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "admin"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 stats message, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "1. Friends of BTC") {
		t.Fatalf("expected Friends of BTC in stats output, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Members 3 | Predictions 7") {
		t.Fatalf("expected member and prediction counts, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "Bal 1,234 sats | PnL +234 sats") {
		t.Fatalf("expected formatted sats output, got %q", gateway.messages[0].text)
	}
}

func TestAdminSendPolymarketRecapCommandRequestsBotAction(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test")
	client.adminSecret = "super-secret"
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/admin/bot" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get(adminSecretHeader); got != "super-secret" {
			t.Fatalf("expected admin secret header, got %q", got)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if !contains(string(body), `"action":"send_polymarket_recap"`) {
			t.Fatalf("unexpected request body %q", string(body))
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(
				`{"requestedAction":"send_polymarket_recap","status":{"desiredState":"running","actualState":"running","heartbeatAt":"2026-04-05T08:00:00Z","isResponsive":true,"tradingEnabled":true}}`,
			)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg: &Config{
			AdminUserIDs: map[int64]struct{}{123: {}},
		},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/send_polymarket_recap",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "admin"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 admin reply, got %d", len(gateway.messages))
	}
	if !contains(gateway.messages[0].text, "Requested a Polymarket BTC recap") {
		t.Fatalf("unexpected message %q", gateway.messages[0].text)
	}
}

func TestSubmitPredictionIncludesTelegramGroupMetadata(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test")
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/predictions" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		payload := string(body)
		if !contains(payload, `"telegram_group_chat_id":"-42"`) {
			t.Fatalf("expected group chat id in payload, got %s", payload)
		}
		if !contains(payload, `"telegram_group_name":"Friends of BTC"`) {
			t.Fatalf("expected group name in payload, got %s", payload)
		}

		return &http.Response{
			StatusCode: http.StatusCreated,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(
				`{"prediction_id":99,"lightning_invoice":"lnbc500n1...","expires_at":"2026-03-27T10:00:00Z"}`,
			)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{
		chatTitles: map[int64]string{-42: "Friends of BTC"},
	}
	bot := &Bot{
		cfg: &Config{
			GroupChatID: -42,
			MinSats:     1000,
			MaxSats:     10000,
		},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "93000 97000 3000",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "alice"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 invoice DM, got %d", len(gateway.messages))
	}
	if gateway.messages[0].parseMode != "HTML" {
		t.Fatalf("expected HTML invoice DM, got parse mode %q", gateway.messages[0].parseMode)
	}
	if !contains(gateway.messages[0].text, "Open in your Lightning wallet") {
		t.Fatalf("expected wallet deep link, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, `href="lightning:lnbc500n1..."`) {
		t.Fatalf("expected lightning href, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "<code>lnbc500n1...</code>") {
		t.Fatalf("expected copyable invoice fallback, got %q", gateway.messages[0].text)
	}
}

func TestSubmitPredictionAcceptsStringPredictionID(t *testing.T) {
	client := NewWebappClient("http://cassandrina.test")
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusCreated,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(
				`{"prediction_id":"99","lightning_invoice":"lnbc500n1...","expires_at":"2026-03-27T10:00:00Z"}`,
			)),
		}, nil
	})}

	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg: &Config{
			GroupChatID: -42,
			MinSats:     1000,
			MaxSats:     10000,
		},
		api:             client,
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "93000 97000 3000",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "alice"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 invoice DM, got %d", len(gateway.messages))
	}
	if gateway.messages[0].parseMode != "HTML" {
		t.Fatalf("expected HTML invoice DM, got parse mode %q", gateway.messages[0].parseMode)
	}
	if !contains(gateway.messages[0].text, "Open in your Lightning wallet") {
		t.Fatalf("expected wallet deep link, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, `href="lightning:lnbc500n1..."`) {
		t.Fatalf("expected lightning href, got %q", gateway.messages[0].text)
	}
	if !contains(gateway.messages[0].text, "<code>lnbc500n1...</code>") {
		t.Fatalf("expected copyable invoice fallback, got %q", gateway.messages[0].text)
	}
}

func TestNonAdminCommandIsRejected(t *testing.T) {
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg: &Config{
			AdminUserIDs: map[int64]struct{}{999: {}},
		},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handlePrivateMessage(context.Background(), &Message{
		Text: "/show_balance_stats",
		Chat: Chat{ID: 123, Type: "private"},
		From: &TelegramUser{ID: 123, Username: "not-admin"},
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 rejection message, got %d", len(gateway.messages))
	}
	if !strings.Contains(gateway.messages[0].text, "configured Telegram admins") {
		t.Fatalf("unexpected rejection text %q", gateway.messages[0].text)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || indexOf(s, substr) >= 0)
}

func indexOf(s, substr string) int {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
