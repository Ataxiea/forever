package lsp

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wowsims/forever/sim/siml"
)

// A rotation of 2000 priority rows, each with a condition.
func longRotation() string {
	var b strings.Builder
	b.WriteString("siml 1\nspec hunter\n\npriority:\n")
	spells := []string{"multi_shot", "arcane_shot", "serpent_sting", "aimed_shot", "raptor_strike"}
	for i := range 2000 {
		fmt.Fprintf(&b, "  cast %s if current_time >= %ds and not target.aura(hunters_mark).is_active\n", spells[i%len(spells)], i%300)
	}
	return b.String()
}

// The time a check of the 2000-row rotation takes as the server makes it: read, then the parser's diagnostics and
// the checks.
func TestDiagnoseTime(t *testing.T) {
	if testing.Short() {
		t.Skip("times a long rotation")
	}
	s := &server{ws: newWorkspaces(), docs: map[string]*document{}, analyses: map[string]*analysis{}, timers: map[string]*time.Timer{}}
	path := filepath.Join(repository, "ui", "specs", "hunter", "dps", "apls", "long.apl.siml")
	uri := pathURI(path)
	s.docs[uri] = &document{uri: uri, path: path, version: 1, text: longRotation()}
	siml.CatalogAt(repository)
	start := time.Now()
	a := s.analyzeLocked(uri)
	read := time.Since(start)
	diags := s.diagnosticsLocked(a)
	diagnosed := time.Since(start)
	start = time.Now()
	if _, err := s.rotation(uri); err != nil {
		t.Fatal(err)
	}
	t.Logf("2000 rows: read in %v, diagnosed in %v, %d diagnostics; siml/rotation after in %v", read, diagnosed, len(diags), time.Since(start))
}
