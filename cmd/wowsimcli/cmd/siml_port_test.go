//go:build with_db

package cmd

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// port prints a JSON preset with no twin next to it, splices a rotation into the .apl.siml it has, keeping the lines
// that still say the same, and deletes the JSON of each.
func TestPortWritesEachJSONPresetAsSIML(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "ui", "specs", "hunter", "dps")
	apls := filepath.Join(dir, "apls")
	if err := os.MkdirAll(apls, 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"defaults.siml":      "siml 1\nspec hunter\n",
		"apls/new.apl.json":  `{"type": "TypeAPL", "priorityList": [{"action": {"castSpell": {"spellId": {"spellId": 14287}}}}]}`,
		"apls/kept.apl.json": `{"type": "TypeAPL", "priorityList": [{"action": {"castSpell": {"spellId": {"spellId": 14325}}}}, {"action": {"castSpell": {"spellId": {"spellId": 2643}}}}]}`,
		"apls/kept.apl.siml": "siml 1\nspec hunter\n\npriority:\n  // Mark first.\n  cast hunters_mark\n",
	}
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	var out, errOut bytes.Buffer
	if err := simlPort(&out, &errOut, []string{dir}); err != nil {
		t.Fatalf("%v\n%s", err, errOut.String())
	}
	if !strings.Contains(out.String(), "kept.apl.json: spliced into kept.apl.siml") || !strings.Contains(out.String(), "new.apl.json: printed as new.apl.siml") {
		t.Errorf("port says:\n%s", out.String())
	}
	for name, want := range map[string]string{
		"apls/new.apl.siml":  "siml 1\nspec hunter\n\npriority:\n  cast arcane_shot\n",
		"apls/kept.apl.siml": "siml 1\nspec hunter\n\npriority:\n  // Mark first.\n  cast hunters_mark\n  cast multi_shot\n",
	} {
		if got, err := os.ReadFile(filepath.Join(dir, name)); err != nil || string(got) != want {
			t.Errorf("%s is %q (%v), want %q", name, got, err, want)
		}
	}
	for _, name := range []string{"apls/new.apl.json", "apls/kept.apl.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Errorf("%s is still there (%v)", name, err)
		}
	}
}
