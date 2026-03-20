package plugin

import (
	"testing"
)

func TestHandleRedisEventPredictionClose(t *testing.T) {
	var messages []string
	bot := &Bot{
		cfg: &Config{MinSats: 100, MaxSats: 5000},
		sendGroup: func(text string) error {
			messages = append(messages, text)
			return nil
		},
		sendDM: func(jid, text string) error { return nil },
	}

	bot.handleRedisEvent("cassandrina:prediction:close", map[string]interface{}{
		"paid_count":   float64(3),
		"total_sats":   float64(1500),
		"close_reason": "window_expired",
	})

	if len(messages) != 1 {
		t.Fatalf("expected 1 group message, got %d", len(messages))
	}
	if want := "Prediction window closed"; !contains(messages[0], want) {
		t.Fatalf("message %q does not contain %q", messages[0], want)
	}
}

func TestHandleRedisEventTradeOpened(t *testing.T) {
	var messages []string
	bot := &Bot{
		cfg: &Config{MinSats: 100, MaxSats: 5000},
		sendGroup: func(text string) error {
			messages = append(messages, text)
			return nil
		},
		sendDM: func(jid, text string) error { return nil },
	}

	bot.handleRedisEvent("cassandrina:trade:opened", map[string]interface{}{
		"strategy":      "B",
		"direction":     "long",
		"entry_price":   float64(90000),
		"target_price":  float64(95000),
		"sats_deployed": float64(2500),
		"dry_run":       true,
	})

	if len(messages) != 1 {
		t.Fatalf("expected 1 group message, got %d", len(messages))
	}
	if want := "Trade opened"; !contains(messages[0], want) {
		t.Fatalf("message %q does not contain %q", messages[0], want)
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
