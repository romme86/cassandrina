package plugin

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Prediction represents a parsed prediction from a Telegram message.
type Prediction struct {
	PredictedLowPrice  float64
	PredictedHighPrice float64
	SatsAmount         int
}

// ErrInvalidFormat is returned when the message does not match "<low> <high> <sats>".
var ErrInvalidFormat = errors.New("invalid prediction format: expected '<low> <high> <sats>'")

// ParsePrediction parses a Telegram message into a Prediction.
func ParsePrediction(msg string, minSats, maxSats int) (*Prediction, error) {
	parts := strings.Fields(strings.TrimSpace(msg))
	if len(parts) != 3 {
		return nil, ErrInvalidFormat
	}

	lowPrice, err := strconv.ParseFloat(parts[0], 64)
	if err != nil || lowPrice <= 0 {
		return nil, fmt.Errorf("invalid low price %q: must be a positive number", parts[0])
	}

	highPrice, err := strconv.ParseFloat(parts[1], 64)
	if err != nil || highPrice <= 0 {
		return nil, fmt.Errorf("invalid high price %q: must be a positive number", parts[1])
	}
	if highPrice < lowPrice {
		return nil, fmt.Errorf("invalid range %q %q: high must be greater than or equal to low", parts[0], parts[1])
	}

	sats, err := strconv.Atoi(parts[2])
	if err != nil || sats <= 0 {
		return nil, fmt.Errorf("invalid sats %q: must be a positive integer", parts[2])
	}

	if sats < minSats {
		return nil, fmt.Errorf("sats %d below minimum %d", sats, minSats)
	}
	if sats > maxSats {
		return nil, fmt.Errorf("sats %d exceeds maximum %d", sats, maxSats)
	}

	return &Prediction{
		PredictedLowPrice:  lowPrice,
		PredictedHighPrice: highPrice,
		SatsAmount:         sats,
	}, nil
}
