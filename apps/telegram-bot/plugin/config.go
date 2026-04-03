package plugin

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config holds all environment-sourced configuration for the bot.
type Config struct {
	RedisURL          string
	WebappAPIURL      string
	InternalAPISecret string
	BotToken          string
	GroupChatID       int64
	AdminUserIDs      map[int64]struct{}
	MinSats           int
	MaxSats           int
}

// LoadConfig reads configuration from environment variables.
func LoadConfig() (*Config, error) {
	groupChatID, err := getRequiredEnvInt64("TELEGRAM_GROUP_CHAT_ID")
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		RedisURL:          getEnvOrDefault("REDIS_URL", "redis://redis:6379/0"),
		InternalAPISecret: os.Getenv("INTERNAL_API_SECRET"),
		BotToken:          os.Getenv("TELEGRAM_BOT_TOKEN"),
		GroupChatID:       groupChatID,
	}
	if cfg.BotToken == "" {
		return nil, fmt.Errorf("TELEGRAM_BOT_TOKEN is required")
	}

	cfg.MinSats, err = getEnvInt("MIN_SATS", 1000)
	if err != nil {
		return nil, fmt.Errorf("MIN_SATS: %w", err)
	}
	cfg.MaxSats, err = getEnvInt("MAX_SATS", 10000)
	if err != nil {
		return nil, fmt.Errorf("MAX_SATS: %w", err)
	}

	cfg.AdminUserIDs, err = getEnvInt64Set("TELEGRAM_ADMIN_USER_IDS")
	if err != nil {
		return nil, fmt.Errorf("TELEGRAM_ADMIN_USER_IDS: %w", err)
	}

	cfg.WebappAPIURL, err = normalizeWebappAPIURL(
		getEnvOrDefault("WEBAPP_API_URL", "http://webapp:3000"),
		os.Getenv("WEBAPP_BASE_PATH"),
	)
	if err != nil {
		return nil, fmt.Errorf("WEBAPP_API_URL: %w", err)
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

func getEnvInt64Set(key string) (map[int64]struct{}, error) {
	values := make(map[int64]struct{})
	raw := os.Getenv(key)
	if raw == "" {
		return values, nil
	}

	for _, part := range strings.Split(raw, ",") {
		item := strings.TrimSpace(part)
		if item == "" {
			continue
		}
		id, err := strconv.ParseInt(item, 10, 64)
		if err != nil {
			return nil, err
		}
		values[id] = struct{}{}
	}

	return values, nil
}

func normalizeWebappAPIURL(rawURL, basePath string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", err
	}

	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("must include scheme and host")
	}

	normalizedBasePath := normalizeBasePath(basePath)
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if normalizedBasePath != "" && (parsed.Path == "" || parsed.Path == "/") {
		parsed.Path = normalizedBasePath
	}

	return strings.TrimRight(parsed.String(), "/"), nil
}

func normalizeBasePath(basePath string) string {
	trimmed := strings.TrimSpace(basePath)
	if trimmed == "" || trimmed == "/" {
		return ""
	}
	if !strings.HasPrefix(trimmed, "/") {
		trimmed = "/" + trimmed
	}
	return strings.TrimRight(trimmed, "/")
}
