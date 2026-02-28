package plugin

import (
	"testing"
)

func TestParsePrediction(t *testing.T) {
	tests := []struct {
		name      string
		msg       string
		wantPrice float64
		wantSats  int
		wantErr   bool
	}{
		{
			name:      "valid prediction",
			msg:       "95000 500",
			wantPrice: 95000,
			wantSats:  500,
		},
		{
			name:      "valid with decimal price",
			msg:       "94500.50 1000",
			wantPrice: 94500.50,
			wantSats:  1000,
		},
		{
			name:    "missing sats",
			msg:     "95000",
			wantErr: true,
		},
		{
			name:    "too many parts",
			msg:     "95000 500 extra",
			wantErr: true,
		},
		{
			name:    "negative price",
			msg:     "-95000 500",
			wantErr: true,
		},
		{
			name:    "zero sats",
			msg:     "95000 0",
			wantErr: true,
		},
		{
			name:    "below min sats",
			msg:     "95000 50",
			wantErr: true,
		},
		{
			name:    "above max sats",
			msg:     "95000 9999",
			wantErr: true,
		},
		{
			name:    "non-numeric price",
			msg:     "abc 500",
			wantErr: true,
		},
		{
			name:    "non-numeric sats",
			msg:     "95000 xyz",
			wantErr: true,
		},
		{
			name:      "leading/trailing whitespace",
			msg:       "  95000 500  ",
			wantPrice: 95000,
			wantSats:  500,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pred, err := ParsePrediction(tt.msg, 100, 5000)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ParsePrediction(%q) error = %v, wantErr = %v", tt.msg, err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if pred.PredictedPrice != tt.wantPrice {
				t.Errorf("price = %v, want %v", pred.PredictedPrice, tt.wantPrice)
			}
			if pred.SatsAmount != tt.wantSats {
				t.Errorf("sats = %v, want %v", pred.SatsAmount, tt.wantSats)
			}
		})
	}
}
