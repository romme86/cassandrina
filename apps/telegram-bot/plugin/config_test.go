package plugin

import "testing"

func TestNormalizeWebappAPIURLAppendsBasePathToBareHost(t *testing.T) {
	got, err := normalizeWebappAPIURL("http://webapp:3000", "/cassandrina")
	if err != nil {
		t.Fatalf("normalizeWebappAPIURL returned error: %v", err)
	}

	if got != "http://webapp:3000/cassandrina" {
		t.Fatalf("expected base path to be appended, got %q", got)
	}
}

func TestNormalizeWebappAPIURLKeepsExistingPath(t *testing.T) {
	got, err := normalizeWebappAPIURL("http://webapp:3000/cassandrina", "/cassandrina")
	if err != nil {
		t.Fatalf("normalizeWebappAPIURL returned error: %v", err)
	}

	if got != "http://webapp:3000/cassandrina" {
		t.Fatalf("expected existing path to be preserved, got %q", got)
	}
}
