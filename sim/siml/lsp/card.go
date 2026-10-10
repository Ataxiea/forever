package lsp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// The game files' row of a spell, as `go run ./tools/spelldata <id>` prints it, for a hover. A row that was had is
// kept per repository and id; one that was not is asked for again by the next hover.

const (
	cardTimeout = 60 * time.Second
	cardSpawns  = 2 // At most this many `go run`s at once.
)

type cards struct {
	mu       sync.Mutex
	goBinary string
	rows     map[string]string
	spawns   chan struct{}
	// Counts the go binary changes, so a row a replaced binary printed is not kept.
	generation int
}

func newCards() *cards {
	return &cards{goBinary: "go", rows: map[string]string{}, spawns: make(chan struct{}, cardSpawns)}
}

// Sets the go binary the wowsims-apl.goBinary setting names, and forgets the rows when it changes.
func (c *cards) setGo(binary string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if binary == c.goBinary {
		return
	}
	c.goBinary = binary
	c.rows = map[string]string{}
	c.generation++
}

// The row of a spell, or false when it cannot be had.
func (c *cards) row(ctx context.Context, root string, spellID int32) (string, bool) {
	key := fmt.Sprintf("%s|%d", root, spellID)
	c.mu.Lock()
	row, ok := c.rows[key]
	binary, generation := c.goBinary, c.generation
	c.mu.Unlock()
	if ok {
		return row, true
	}
	goPath, ok := findGo(binary)
	if !ok {
		return "", false
	}
	select {
	case c.spawns <- struct{}{}:
		defer func() { <-c.spawns }()
	case <-ctx.Done():
		return "", false
	}
	ctx, cancel := context.WithTimeout(ctx, cardTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, goPath, "run", "./tools/spelldata", fmt.Sprint(spellID))
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		return "", false
	}
	row = strings.TrimSpace(string(out))
	c.mu.Lock()
	if c.generation == generation {
		c.rows[key] = row
	}
	c.mu.Unlock()
	return row, true
}

// The go binary the setting names: `go` searches the PATH, GOROOT and the usual install folders, since an editor
// started from a desktop launcher or a remote server often lacks the shell's PATH; anything else is the binary.
func findGo(configured string) (string, bool) {
	if configured != "go" {
		return configured, isFile(configured)
	}
	exe := "go"
	if runtime.GOOS == "windows" {
		exe = "go.exe"
	}
	var candidates []string
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		if dir != "" {
			candidates = append(candidates, filepath.Join(dir, exe))
		}
	}
	if goroot := os.Getenv("GOROOT"); goroot != "" {
		candidates = append(candidates, filepath.Join(goroot, "bin", exe))
	}
	candidates = append(candidates, "/usr/local/go/bin/go", "/usr/lib/go/bin/go", "/opt/homebrew/bin/go")
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, filepath.Join(home, "go", "bin", exe))
	}
	candidates = append(candidates, `C:\Program Files\Go\bin\go.exe`)
	for _, path := range candidates {
		if isFile(path) {
			return path, true
		}
	}
	return "", false
}
