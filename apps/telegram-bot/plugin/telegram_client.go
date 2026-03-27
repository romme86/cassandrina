package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type TelegramGateway interface {
	GetUpdates(ctx context.Context, offset int, timeoutSeconds int) ([]Update, error)
	SendMessage(ctx context.Context, chatID int64, text string, replyToMessageID int) error
	DeepLink(ctx context.Context) string
	SyncCommands(ctx context.Context) error
}

type TelegramClient struct {
	botToken    string
	baseURL     string
	httpClient  *http.Client
	botUsername string
}

type Update struct {
	UpdateID int      `json:"update_id"`
	Message  *Message `json:"message"`
}

type Message struct {
	MessageID int           `json:"message_id"`
	Text      string        `json:"text"`
	Chat      Chat          `json:"chat"`
	From      *TelegramUser `json:"from"`
}

type Chat struct {
	ID       int64  `json:"id"`
	Type     string `json:"type"`
	Title    string `json:"title"`
	Username string `json:"username"`
}

type TelegramUser struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

type telegramAPIResponse[T any] struct {
	OK          bool   `json:"ok"`
	Description string `json:"description"`
	Result      T      `json:"result"`
}

type TelegramCommand struct {
	Command     string `json:"command"`
	Description string `json:"description"`
}

func NewTelegramClient(botToken string) *TelegramClient {
	return &TelegramClient{
		botToken:   botToken,
		baseURL:    "https://api.telegram.org/bot" + botToken,
		httpClient: &http.Client{Timeout: 35 * time.Second},
	}
}

func (c *TelegramClient) GetUpdates(ctx context.Context, offset int, timeoutSeconds int) ([]Update, error) {
	values := url.Values{}
	values.Set("offset", strconv.Itoa(offset))
	values.Set("timeout", strconv.Itoa(timeoutSeconds))

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		c.baseURL+"/getUpdates?"+values.Encode(),
		nil,
	)
	if err != nil {
		return nil, err
	}

	var response telegramAPIResponse[[]Update]
	if err := c.do(req, &response); err != nil {
		return nil, err
	}
	return response.Result, nil
}

func (c *TelegramClient) SendMessage(ctx context.Context, chatID int64, text string, replyToMessageID int) error {
	payload := map[string]interface{}{
		"chat_id":                  chatID,
		"text":                     text,
		"disable_web_page_preview": true,
	}
	if replyToMessageID > 0 {
		payload["reply_to_message_id"] = replyToMessageID
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/sendMessage",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	var response telegramAPIResponse[map[string]interface{}]
	return c.do(req, &response)
}

func (c *TelegramClient) DeepLink(ctx context.Context) string {
	if c.botUsername == "" {
		user, err := c.getMe(ctx)
		if err != nil {
			return ""
		}
		c.botUsername = user.Username
	}
	if c.botUsername == "" {
		return ""
	}
	return "https://t.me/" + c.botUsername
}

func (c *TelegramClient) SyncCommands(ctx context.Context) error {
	payload := map[string]any{
		"commands": []TelegramCommand{
			{Command: "start", Description: "Start a private chat with Cassandrina"},
			{Command: "help", Description: "Show bot usage and commands"},
			{Command: "my_stats", Description: "Show your Telegram-linked stats"},
			{Command: "health", Description: "Check webapp health from the bot"},
			{Command: "status", Description: "Show bot status and role info"},
			{Command: "prediction_status", Description: "Show the current prediction round status"},
			{Command: "position_status", Description: "Show the current market position status"},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/setMyCommands",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	var response telegramAPIResponse[bool]
	return c.do(req, &response)
}

func (c *TelegramClient) getMe(ctx context.Context) (*TelegramUser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/getMe", nil)
	if err != nil {
		return nil, err
	}

	var response telegramAPIResponse[TelegramUser]
	if err := c.do(req, &response); err != nil {
		return nil, err
	}
	return &response.Result, nil
}

func (c *TelegramClient) do(req *http.Request, target interface{}) error {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("telegram api returned HTTP %d", resp.StatusCode)
	}

	if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
		return err
	}

	switch typed := target.(type) {
	case *telegramAPIResponse[[]Update]:
		if !typed.OK {
			return fmt.Errorf("telegram api error: %s", typed.Description)
		}
	case *telegramAPIResponse[map[string]interface{}]:
		if !typed.OK {
			return fmt.Errorf("telegram api error: %s", typed.Description)
		}
	case *telegramAPIResponse[TelegramUser]:
		if !typed.OK {
			return fmt.Errorf("telegram api error: %s", typed.Description)
		}
	case *telegramAPIResponse[bool]:
		if !typed.OK {
			return fmt.Errorf("telegram api error: %s", typed.Description)
		}
	}

	return nil
}
