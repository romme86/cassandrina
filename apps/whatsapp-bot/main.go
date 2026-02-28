// Cassandrina WhatsApp Bot
// Lightweight PicoClaw plugin built as a static Go binary.
//
// In production this binary is called by PicoClaw's plugin API.
// For integration testing it can be run standalone.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/cassandrina/whatsapp-bot/plugin"
)

func main() {
	cfg, err := plugin.LoadConfig()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	// In a real PicoClaw integration, sendDM and sendGroup would call
	// PicoClaw's internal messaging API. Here we use stubs for standalone mode.
	sendDM := func(jid, text string) error {
		log.Printf("[DM → %s] %s", jid, text)
		return nil
	}
	sendGroup := func(text string) error {
		log.Printf("[GROUP] %s", text)
		return nil
	}

	bot, err := plugin.NewBot(cfg, sendDM, sendGroup)
	if err != nil {
		log.Fatalf("bot init error: %v", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	log.Println("Cassandrina WhatsApp bot started")
	if err := bot.Run(ctx); err != nil {
		log.Printf("bot stopped: %v", err)
	}
}
