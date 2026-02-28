package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/redis/go-redis/v9"
)

// EventHandler is called when an event arrives on a Redis channel.
type EventHandler func(event string, payload map[string]interface{})

// RedisSubscriber listens to Cassandrina Redis channels and dispatches events.
type RedisSubscriber struct {
	client  *redis.Client
	handler EventHandler
}

// Channels that the WhatsApp bot subscribes to.
var cassandrinaChannels = []string{
	"cassandrina:prediction:open",
	"cassandrina:prediction:close",
	"cassandrina:trade:opened",
	"cassandrina:trade:closed",
	"cassandrina:trade:liquidated",
	"cassandrina:stats:8h",
	"cassandrina:weekly:vote",
}

// NewRedisSubscriber creates a subscriber connected to *redisURL*.
func NewRedisSubscriber(redisURL string, handler EventHandler) (*RedisSubscriber, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis URL: %w", err)
	}
	return &RedisSubscriber{
		client:  redis.NewClient(opts),
		handler: handler,
	}, nil
}

// Run subscribes and blocks until ctx is cancelled.
func (s *RedisSubscriber) Run(ctx context.Context) error {
	pubsub := s.client.Subscribe(ctx, cassandrinaChannels...)
	defer pubsub.Close()

	log.Printf("[redis] subscribed to %v", cassandrinaChannels)

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return nil
		case msg, ok := <-ch:
			if !ok {
				return fmt.Errorf("redis channel closed")
			}
			s.dispatch(msg)
		}
	}
}

func (s *RedisSubscriber) dispatch(msg *redis.Message) {
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(msg.Payload), &payload); err != nil {
		log.Printf("[redis] failed to parse payload on %s: %v", msg.Channel, err)
		return
	}
	s.handler(msg.Channel, payload)
}
