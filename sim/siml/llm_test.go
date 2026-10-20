package siml

import (
	"os"
	"path/filepath"
	"testing"
)

// siml.llm.txt lists the kinds the protos give, so a change to apl.proto leaves it stale until it is written again.
func TestLLMTextIsCurrent(t *testing.T) {
	want, err := LLMText()
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join("..", "..", "siml.llm.txt"))
	if err != nil || string(got) != want {
		t.Errorf("siml.llm.txt is not what the schema writes (%v); run make siml, or go run ./cmd/wowsimcli siml llm -o siml.llm.txt", err)
	}
}
