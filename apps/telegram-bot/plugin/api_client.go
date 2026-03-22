package plugin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// PredictionRequest is sent to POST /api/predictions.
type PredictionRequest struct {
	Platform        string  `json:"platform"`
	PlatformUserID  string  `json:"platform_user_id"`
	DisplayName     string  `json:"display_name,omitempty"`
	PredictedPrice  float64 `json:"predicted_price"`
	SatsAmount      int     `json:"sats_amount"`
	RoundID         int     `json:"round_id,omitempty"`
}

// PredictionResponse is returned by POST /api/predictions.
type PredictionResponse struct {
	PredictionID     int    `json:"prediction_id"`
	LightningInvoice string `json:"lightning_invoice"`
	ExpiresAt        string `json:"expires_at"`
}

// WebappClient calls the Next.js API.
type WebappClient struct {
	baseURL    string
	httpClient *http.Client
}

func NewWebappClient(baseURL string) *WebappClient {
	return &WebappClient{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *WebappClient) CreatePrediction(req PredictionRequest) (*PredictionResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	resp, err := c.httpClient.Post(
		c.baseURL+"/api/predictions",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("POST /api/predictions: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("POST /api/predictions returned HTTP %d", resp.StatusCode)
	}

	var result PredictionResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}
