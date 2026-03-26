package plugin

import "testing"

func TestParsePrediction(t *testing.T) {
	tests := []struct {
		name     string
		msg      string
		wantLow  float64
		wantHigh float64
		wantSats int
		wantErr  bool
	}{
		{
			name:     "valid prediction",
			msg:      "93000 97000 500",
			wantLow:  93000,
			wantHigh: 97000,
			wantSats: 500,
		},
		{
			name:     "valid with decimal prices",
			msg:      "94500.50 95500.25 1000",
			wantLow:  94500.50,
			wantHigh: 95500.25,
			wantSats: 1000,
		},
		{
			name:    "missing values",
			msg:     "95000 97000",
			wantErr: true,
		},
		{
			name:    "too many parts",
			msg:     "95000 97000 500 extra",
			wantErr: true,
		},
		{
			name:    "negative low price",
			msg:     "-95000 97000 500",
			wantErr: true,
		},
		{
			name:    "high below low",
			msg:     "97000 95000 500",
			wantErr: true,
		},
		{
			name:    "zero sats",
			msg:     "95000 97000 0",
			wantErr: true,
		},
		{
			name:    "below min sats",
			msg:     "95000 97000 50",
			wantErr: true,
		},
		{
			name:    "above max sats",
			msg:     "95000 97000 9999",
			wantErr: true,
		},
		{
			name:    "non-numeric low price",
			msg:     "abc 97000 500",
			wantErr: true,
		},
		{
			name:    "non-numeric high price",
			msg:     "95000 xyz 500",
			wantErr: true,
		},
		{
			name:    "non-numeric sats",
			msg:     "95000 97000 xyz",
			wantErr: true,
		},
		{
			name:     "leading trailing whitespace",
			msg:      "  95000 97000 500  ",
			wantLow:  95000,
			wantHigh: 97000,
			wantSats: 500,
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
			if pred.PredictedLowPrice != tt.wantLow {
				t.Errorf("low = %v, want %v", pred.PredictedLowPrice, tt.wantLow)
			}
			if pred.PredictedHighPrice != tt.wantHigh {
				t.Errorf("high = %v, want %v", pred.PredictedHighPrice, tt.wantHigh)
			}
			if pred.SatsAmount != tt.wantSats {
				t.Errorf("sats = %v, want %v", pred.SatsAmount, tt.wantSats)
			}
		})
	}
}
