package plugin

import (
	"fmt"
	"os"
	"strconv"
)

// Config holds all environment-sourced configuration for the bot.
type Config struct {
	RedisURL     string
	WebappAPIURL string
	BotToken     string
	GroupChatID  int64
	MinSats      int
	MaxSats      int
}

// LoadConfig reads configuration from environment variables.
func LoadConfig() (*Config, error) {
	groupChatID, err := getRequiredEnvInt64("TELEGRAM_GROUP_CHAT_ID")
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		RedisURL:     getEnvOrDefault("REDIS_URL", "redis://redis:6379/0"),
		WebappAPIURL: getEnvOrDefault("WEBAPP_API_URL", "http://webapp:3000"),
		BotToken:     os.Getenv("TELEGRAM_BOT_TOKEN"),
		GroupChatID:  groupChatID,
	}
	if cfg.BotToken == "" {
		return nil, fmt.Errorf("TELEGRAM_BOT_TOKEN is required")
	}

	cfg.MinSats, err = getEnvInt("MIN_SATS", 100)
	if err != nil {
		return nil, fmt.Errorf("MIN_SATS: %w", err)
	}
	cfg.MaxSats, err = getEnvInt("MAX_SATS", 5000)
	if err != nil {
		return nil, fmt.Errorf("MAX_SATS: %w", err)
	}

	return cfg, nil
}

func getEnvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	return strconv.Atoi(v)
}

func getRequiredEnvInt64(key string) (int64, error) {
	v := os.Getenv(key)
	if v == "" {
		return 0, fmt.Errorf("%s is required", key)
	}
	return strconv.ParseInt(v, 10, 64)
}
