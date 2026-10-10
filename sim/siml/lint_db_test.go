//go:build with_db

package siml

import (
	"slices"
	"strings"
	"testing"
)

// The repository's rotations, in the x.apl.siml files under ui/specs and in the full files that hold one, carry no
// error or warning.
func TestLintCommittedRotations(t *testing.T) {
	files := committedFiles(t)
	if len(files) == 0 {
		t.Fatal("ui/specs holds no .siml file")
	}
	linted := 0
	for _, file := range files {
		f, err := ReadFile(file)
		if err != nil {
			t.Errorf("%s: %v", file, err)
			continue
		}
		if !slices.Contains(f.Categories, rotationCategory) {
			continue
		}
		linted++
		serious := slices.DeleteFunc(Lint(f.Rotation()), func(x Finding) bool { return x.Severity == "info" })
		if len(serious) > 0 {
			t.Errorf("%s:\n%s", file, strings.Join(findingLines(serious, "severity", "code", "path", "message"), "\n"))
		}
	}
	if linted == 0 {
		t.Error("no file under ui/specs holds a rotation")
	}
}
