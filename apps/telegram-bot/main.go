package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/cassandrina/telegram-bot/plugin"
)

func main() {
	cfg, err := plugin.LoadConfig()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	bot, err := plugin.NewBot(cfg)
	if err != nil {
		log.Fatalf("bot init error: %v", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	log.Println("Cassandrina Telegram bot started")
	if err := bot.Run(ctx); err != nil {
		log.Printf("bot stopped: %v", err)
	}
}
