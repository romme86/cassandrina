package plugin

import (
	"fmt"
	"os"
	"strconv"
)

// Config holds all environment-sourced configuration for the bot plugin.
type Config struct {
	RedisURL       string
	WebappAPIURL   string
	GroupJID       string
	SessionPath    string
	MinSats        int
	MaxSats        int
}

// LoadConfig reads configuration from environment variables.
// Returns an error if required variables are missing.
func LoadConfig() (*Config, error) {
	cfg := &Config{
		RedisURL:     getEnvOrDefault("REDIS_URL", "redis://redis:6379/0"),
		WebappAPIURL: getEnvOrDefault("WEBAPP_API_URL", "http://webapp:3000"),
		GroupJID:     os.Getenv("PICOCLAW_WHATSAPP_GROUP_JID"),
		SessionPath:  getEnvOrDefault("PICOCLAW_WHATSAPP_SESSION_PATH", "/data/whatsapp-session"),
	}

	var err error
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
