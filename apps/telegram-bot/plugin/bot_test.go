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
	replyToMessageID int
}

type fakeTelegramGateway struct {
	messages    []sentMessage
	sendError   error
	deepLinkURL string
}

func (f *fakeTelegramGateway) GetUpdates(context.Context, int, int) ([]Update, error) {
	return nil, nil
}

func (f *fakeTelegramGateway) SendMessage(_ context.Context, chatID int64, text string, replyToMessageID int) error {
	f.messages = append(f.messages, sentMessage{chatID: chatID, text: text, replyToMessageID: replyToMessageID})
	return f.sendError
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
		cfg:             &Config{MinSats: 100, MaxSats: 5000, GroupChatID: -42},
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

func TestHandleRedisEventPredictionOpenIncludesConfiguredTimezone(t *testing.T) {
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{MinSats: 100, MaxSats: 5000, GroupChatID: -42},
		telegram:        gateway,
		pendingInvoices: make(map[int64]string),
	}

	bot.handleRedisEvent("cassandrina:prediction:open", map[string]interface{}{
		"target_hour":     float64(8),
		"target_timezone": "Europe/Rome",
		"min_sats":        float64(100),
		"max_sats":        float64(5000),
	})

	if len(gateway.messages) != 1 {
		t.Fatalf("expected 1 group message, got %d", len(gateway.messages))
	}
	if want := "08:00 Europe/Rome"; !contains(gateway.messages[0].text, want) {
		t.Fatalf("message %q does not contain %q", gateway.messages[0].text, want)
	}
}

func TestHandleGroupMessageStoresPendingInvoiceWhenDMFails(t *testing.T) {
	gateway := &fakeTelegramGateway{sendError: errors.New("dm blocked"), deepLinkURL: "https://t.me/cassandrina_bot"}
	bot := &Bot{
		cfg:             &Config{MinSats: 100, MaxSats: 5000, GroupChatID: -42},
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
	gateway := &fakeTelegramGateway{}
	bot := &Bot{
		cfg:             &Config{MinSats: 100, MaxSats: 5000, GroupChatID: -42},
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
				`{"user_id":42,"display_name":"Alice","platform_user_id":"123","accuracy":61.5,"congruency":52.2,"balance_sats":1234,"profit_sats":234,"total_predictions":7}`,
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
				`{"has_round":true,"round_id":12,"question_date":"2026-03-27","target_hour":19,"target_timezone":"Europe/Zurich","open_at":"2026-03-27T07:00:00Z","close_at":"2026-03-27T08:30:00Z","status":"open","participant_count":2,"confirmed_count":1,"participants":[{"display_name":"Alice","paid":true,"created_at":"2026-03-27T07:05:00Z","paid_at":"2026-03-27T07:06:00Z"},{"display_name":"Bob","paid":false,"created_at":"2026-03-27T07:10:00Z","paid_at":""}]}`,
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
				`{"phase":"open_position","has_position":true,"trade_id":44,"round_id":12,"question_date":"2026-03-27","target_hour":19,"target_timezone":"Europe/Zurich","open_at":"","close_at":"","status":"open","strategy":"C","direction":"long","entry_price":87123.45,"target_price":87000,"leverage":3,"opened_at":"2026-03-27T08:35:00Z","closed_at":"","pnl_sats":null}`,
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
				`{"round_id":12,"question_date":"2026-03-25","target_hour":16,"target_timezone":"Europe/Zurich","close_at":"2026-03-25T12:30:00Z","minutes":30}`,
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
				`{"round_id":12,"replaced_round_id":7,"question_date":"2026-03-25","target_hour":16,"target_timezone":"Europe/Zurich","close_at":"2026-03-25T12:05:00Z","minutes":5}`,
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
				{"id":1,"display_name":"Alice","accuracy":61.5,"congruency":52.2,"balance_sats":1234,"profit_sats":234,"total_predictions":7},
				{"id":2,"display_name":"Bob","accuracy":55.0,"congruency":49.0,"balance_sats":900,"profit_sats":-100,"total_predictions":4}
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
