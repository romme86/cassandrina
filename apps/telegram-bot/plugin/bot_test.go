package plugin

import (
	"context"
	"errors"
	"testing"
)

type sentMessage struct {
	chatID          int64
	text            string
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
	if want := "Prediction window closed"; !contains(gateway.messages[0].text, want) {
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
