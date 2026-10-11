package lsp

import (
	"fmt"
	"strings"
	"sync"

	"github.com/wowsims/forever/tools/spelldata/printer"
)

// The game files' row of a spell, as `go run ./tools/spelldata <id>` prints it, for a hover, kept per repository
// and id.
type cards struct {
	mu   sync.Mutex
	rows map[string]string
}

func newCards() *cards {
	return &cards{rows: map[string]string{}}
}

// The row of a spell, or false for an id the store does not carry.
func (c *cards) row(root string, spellID int32) (string, bool) {
	key := fmt.Sprintf("%s|%d", root, spellID)
	c.mu.Lock()
	row, ok := c.rows[key]
	c.mu.Unlock()
	if ok {
		return row, true
	}
	row, ok = printer.Row(spellID)
	if !ok {
		return "", false
	}
	row = strings.TrimSpace(row)
	c.mu.Lock()
	c.rows[key] = row
	c.mu.Unlock()
	return row, true
}
