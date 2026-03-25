package plugin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const adminSecretHeader = "x-cassandrina-admin-secret"

// PredictionRequest is sent to POST /api/predictions.
type PredictionRequest struct {
	Platform       string  `json:"platform"`
	PlatformUserID string  `json:"platform_user_id"`
	DisplayName    string  `json:"display_name,omitempty"`
	PredictedPrice float64 `json:"predicted_price"`
	SatsAmount     int     `json:"sats_amount"`
	RoundID        int     `json:"round_id,omitempty"`
}

// PredictionResponse is returned by POST /api/predictions.
type PredictionResponse struct {
	PredictionID     int    `json:"prediction_id"`
	LightningInvoice string `json:"lightning_invoice"`
	ExpiresAt        string `json:"expires_at"`
}

type StartPredictionRoundResponse struct {
	RoundID         int    `json:"round_id"`
	ReplacedRoundID *int   `json:"replaced_round_id"`
	QuestionDate    string `json:"question_date"`
	TargetHour      int    `json:"target_hour"`
	TargetTimeZone  string `json:"target_timezone"`
	CloseAt         string `json:"close_at"`
	Minutes         int    `json:"minutes"`
}

type BalanceStatsResponse struct {
	RoundID          int    `json:"round_id"`
	QuestionDate     string `json:"question_date"`
	TargetHour       int    `json:"target_hour"`
	HoursToTarget    int    `json:"hours_to_target"`
	ParticipantCount int    `json:"participant_count"`
	PaidCount        int    `json:"paid_count"`
	TotalSats        int    `json:"total_sats"`
}

type UserStatsRow struct {
	ID               int     `json:"id"`
	DisplayName      string  `json:"display_name"`
	Accuracy         float64 `json:"accuracy"`
	Congruency       float64 `json:"congruency"`
	BalanceSats      int     `json:"balance_sats"`
	ProfitSats       int     `json:"profit_sats"`
	TotalPredictions int     `json:"total_predictions"`
}

type MyStatsResponse struct {
	UserID           *int    `json:"user_id"`
	DisplayName      string  `json:"display_name"`
	PlatformUserID   string  `json:"platform_user_id"`
	Accuracy         float64 `json:"accuracy"`
	Congruency       float64 `json:"congruency"`
	BalanceSats      int     `json:"balance_sats"`
	ProfitSats       int     `json:"profit_sats"`
	TotalPredictions int     `json:"total_predictions"`
}

type apiErrorResponse struct {
	Error string `json:"error"`
}

type APIError struct {
	Path       string
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	path := e.Path
	if path == "" {
		path = "/api/predictions"
	}
	if e.Message == "" {
		return fmt.Sprintf("request to %s returned HTTP %d", path, e.StatusCode)
	}
	return fmt.Sprintf("request to %s returned HTTP %d: %s", path, e.StatusCode, e.Message)
}

func (e *APIError) UserMessage() string {
	if e == nil || e.Message == "" {
		return "Could not register your prediction. Please try again."
	}
	return e.Message
}

// WebappClient calls the Next.js API.
type WebappClient struct {
	baseURL     string
	httpClient  *http.Client
	adminSecret string
}

func NewWebappClient(baseURL string) *WebappClient {
	return &WebappClient{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *WebappClient) CreatePrediction(req PredictionRequest) (*PredictionResponse, error) {
	request, err := c.newJSONRequest(http.MethodPost, "/api/predictions", req, false)
	if err != nil {
		return nil, err
	}

	var result PredictionResponse
	if err := c.doJSON(request, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

func (c *WebappClient) StartPredictionRound(minutes int) (*StartPredictionRoundResponse, error) {
	request, err := c.newJSONRequest(
		http.MethodPost,
		"/api/admin/predictions/start",
		map[string]int{"minutes": minutes},
		true,
	)
	if err != nil {
		return nil, err
	}

	var result StartPredictionRoundResponse
	if err := c.doJSON(request, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

func (c *WebappClient) GetBalanceStats() (*BalanceStatsResponse, error) {
	request, err := c.newJSONRequest(http.MethodGet, "/api/admin/stats/balance", nil, true)
	if err != nil {
		return nil, err
	}

	var result BalanceStatsResponse
	if err := c.doJSON(request, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

func (c *WebappClient) GetUserStats() ([]UserStatsRow, error) {
	request, err := c.newJSONRequest(http.MethodGet, "/api/admin/stats/users", nil, true)
	if err != nil {
		return nil, err
	}

	var result []UserStatsRow
	if err := c.doJSON(request, &result); err != nil {
		return nil, err
	}

	return result, nil
}

func (c *WebappClient) GetMyStats(platform, platformUserID string) (*MyStatsResponse, error) {
	request, err := c.newJSONRequest(
		http.MethodGet,
		fmt.Sprintf(
			"/api/internal/users/stats?platform=%s&platform_user_id=%s",
			url.QueryEscape(platform),
			url.QueryEscape(platformUserID),
		),
		nil,
		true,
	)
	if err != nil {
		return nil, err
	}

	var result MyStatsResponse
	if err := c.doJSON(request, &result); err != nil {
		return nil, err
	}

	return &result, nil
}

func (c *WebappClient) HasAdminSecret() bool {
	return strings.TrimSpace(c.adminSecret) != ""
}

func (c *WebappClient) newJSONRequest(method, path string, payload interface{}, useAdminSecret bool) (*http.Request, error) {
	var body io.Reader
	if payload != nil {
		bodyBytes, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}
		body = bytes.NewReader(bodyBytes)
	}

	req, err := http.NewRequest(method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if useAdminSecret && c.adminSecret != "" {
		req.Header.Set(adminSecretHeader, c.adminSecret)
	}
	return req, nil
}

func (c *WebappClient) doJSON(req *http.Request, target interface{}) error {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%s %s: %w", req.Method, req.URL.Path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return parseAPIError(req, resp)
	}

	if target == nil {
		return nil
	}

	if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}

	return nil
}

func parseAPIError(req *http.Request, resp *http.Response) error {
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read error response: %w", err)
	}

	message := strings.TrimSpace(string(bodyBytes))
	var apiErr apiErrorResponse
	if len(bodyBytes) > 0 && json.Unmarshal(bodyBytes, &apiErr) == nil && strings.TrimSpace(apiErr.Error) != "" {
		message = strings.TrimSpace(apiErr.Error)
	}

	return &APIError{
		Path:       req.URL.Path,
		StatusCode: resp.StatusCode,
		Message:    message,
	}
}
