package plugin

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Prediction represents a parsed prediction from a WhatsApp message.
type Prediction struct {
	PredictedPrice float64
	SatsAmount     int
}

// ErrInvalidFormat is returned when the message does not match "<price> <sats>".
var ErrInvalidFormat = errors.New("invalid prediction format: expected '<price> <sats>'")

// ParsePrediction parses a WhatsApp message into a Prediction.
// Expected format: "<price> <sats>" e.g. "95000 500"
func ParsePrediction(msg string, minSats, maxSats int) (*Prediction, error) {
	parts := strings.Fields(strings.TrimSpace(msg))
	if len(parts) != 2 {
		return nil, ErrInvalidFormat
	}

	price, err := strconv.ParseFloat(parts[0], 64)
	if err != nil || price <= 0 {
		return nil, fmt.Errorf("invalid price %q: must be a positive number", parts[0])
	}

	sats, err := strconv.Atoi(parts[1])
	if err != nil || sats <= 0 {
		return nil, fmt.Errorf("invalid sats %q: must be a positive integer", parts[1])
	}

	if sats < minSats {
		return nil, fmt.Errorf("sats %d below minimum %d", sats, minSats)
	}
	if sats > maxSats {
		return nil, fmt.Errorf("sats %d exceeds maximum %d", sats, maxSats)
	}

	return &Prediction{
		PredictedPrice: price,
		SatsAmount:     sats,
	}, nil
}
