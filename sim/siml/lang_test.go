package siml

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/wowsims/forever/sim/core/proto"
)

// The language services on a table of four names, which needs neither the committed table nor the item database: a
// hunter spell its builds register, one no build registers, and two shared ones, the first registered by the warrior's
// builds alone.

func smallNames() *Names {
	return &Names{
		Classes: map[proto.Class]SpellNames{proto.Class_ClassHunter: {NamespaceSpell: {
			"steady": {SpellID: 900001, RegisteredBy: []string{"hunter"}},
			"kept":   {SpellID: 900002},
		}}},
		Shared: SpellNames{NamespaceSpell: {
			"warriors_only": {SpellID: 900003, RegisteredBy: []string{"dps_warrior"}},
			"everyones":     {SpellID: 900004, RegisteredBy: []string{"dps_warrior", "hunter"}},
		}},
	}
}

// The repository root, and the paths the cases read their text as.
var (
	langRoot     = func() string { root, _ := filepath.Abs(filepath.Join("..", "..")); return root }()
	hunterPath   = filepath.Join(langRoot, "x.apl.siml")
	setupPath    = filepath.Join(langRoot, "x.siml")
	gearPath     = filepath.Join(langRoot, "x.gear.siml")
	specsPath    = filepath.Join(langRoot, "ui", "specs", "hunter", "dps", "apls", "x.apl.siml")
	langOpen     = Opener(func(path string) ([]byte, error) { return readDisk(path) })
	langPreface  = "siml 1\nspec hunter\n\nvar ${Melee weave} = true\n"
	plainPreface = "siml 1\nspec hunter\n\n"
)

// The text with its `|` taken out, and the position the `|` marked.
func marked(text string) (string, Position) {
	at := strings.IndexByte(text, '|')
	text = text[:at] + text[at+1:]
	return text, newLineMap(text).position(at)
}

// Where needle starts in text, plus k.
func positionOf(text, needle string, k int) Position {
	return newLineMap(text).position(strings.Index(text, needle) + k)
}

func completionsIn(t *testing.T, names *Names, c Catalog, path, source string) []Completion {
	t.Helper()
	text, at := marked(source)
	return Analyze(path, []byte(text), names, langOpen).Complete(at, c)
}

func labelsOf(items []Completion) []string {
	out := make([]string, len(items))
	for i, x := range items {
		out[i] = x.Label
	}
	return out
}

// [line (0-based, as an editor counts), code, severity (1 error, 2 warning, 3 information)] of each diagnostic.
type diagRow struct {
	line     int
	code     string
	severity int
}

func diagRows(diags Diagnostics) []diagRow {
	out := make([]diagRow, len(diags))
	for i, x := range diags {
		out[i] = diagRow{x.Start.Line - 1, x.Code, int(x.Severity) + 1}
	}
	return out
}

func TestRegisteredNames(t *testing.T) {
	names := smallNames()
	var got []string
	for _, n := range names.Registered(proto.Class_ClassHunter, "hunter", NamespaceSpell) {
		got = append(got, n.Name+map[bool]string{true: " shared", false: ""}[n.Shared])
	}
	if want := []string{"steady", "everyones shared"}; !slices.Equal(got, want) {
		t.Errorf("hunter: %v, want %v", got, want)
	}
	got = nil
	for _, n := range names.Registered(proto.Class_ClassUnknown, "", NamespaceSpell) {
		got = append(got, n.Name)
	}
	if want := []string{"everyones", "warriors_only"}; !slices.Equal(got, want) {
		t.Errorf("no spec: %v, want %v", got, want)
	}
}

func TestCompleteRegisteredNamesOnly(t *testing.T) {
	names := smallNames()
	hunter := labelsOf(completionsIn(t, names, nil, hunterPath, langPreface+"priority:\n  cast |\n"))
	if !slices.Contains(hunter, "steady") || !slices.Contains(hunter, "everyones") {
		t.Errorf("hunter offers %v", hunter)
	}
	if slices.Contains(hunter, "kept") || slices.Contains(hunter, "warriors_only") {
		t.Errorf("hunter offers a name its builds do not register: %v", hunter)
	}
	noSpec := labelsOf(completionsIn(t, names, nil, filepath.Join(langRoot, "x.cooldowns.siml"), "siml 1\n\ncooldowns(id=|\n"))
	if !slices.Contains(noSpec, "warriors_only") || !slices.Contains(noSpec, "everyones") || slices.Contains(noSpec, "steady") {
		t.Errorf("no spec offers %v", noSpec)
	}
}

func TestCompleteClassNamesFirst(t *testing.T) {
	var offered []Completion
	for _, x := range completionsIn(t, smallNames(), nil, hunterPath, langPreface+"priority:\n  cast |\n") {
		if x.Kind == CompletionConstant {
			offered = append(offered, x)
		}
	}
	slices.SortFunc(offered, func(a, b Completion) int { return strings.Compare(a.SortText, b.SortText) })
	var got [][2]string
	for _, x := range offered {
		got = append(got, [2]string{x.Label, x.Detail})
	}
	want := [][2]string{{"steady", "(900001)"}, {"everyones", "(900004), from gear, consumables or encounters"}}
	if !slices.Equal(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestChecksUnregisteredName(t *testing.T) {
	text := plainPreface + "priority:\n  cast kept\n  cast steady\n"
	outside := Analyze(hunterPath, []byte(text), smallNames(), langOpen).EditorDiagnostics(nil)
	if got, want := diagRows(outside), []diagRow{{4, "unregistered-name", 2}}; !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if got, want := outside[0].Message, "kept is a spell no hunter build registers"; got != want {
		t.Errorf("message %q, want %q", got, want)
	}
	inside := Analyze(specsPath, []byte(text), smallNames(), langOpen).EditorDiagnostics(nil)
	if len(inside) == 0 || inside[0].Severity != Error {
		t.Errorf("under ui/specs: %v", diagRows(inside))
	}
}

func TestQuickFixRewrites(t *testing.T) {
	text := langPreface + "priority:\n  cast steady if current_time > 1s and and(gcd_is_ready) or (gcd_is_ready or current_time < 5s)\n"
	d := Analyze(hunterPath, []byte(text), smallNames(), langOpen)
	var got []string
	for _, f := range d.QuickFixes(Range{Position{1, 1}, Position{10, 1}}, nil) {
		if f.Kind == "refactor.rewrite" {
			got = append(got, f.Edits[0].NewText)
		}
	}
	if want := []string{"gcd_is_ready", "gcd_is_ready or current_time < 5s"}; !slices.Equal(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestQuickFixSkipsListOperand(t *testing.T) {
	text := langPreface + "priority:\n  cast steady if and([gcd_is_ready, true]) and or([gcd_is_ready]) and and([true])\n"
	d := Analyze(hunterPath, []byte(text), smallNames(), langOpen)
	for _, f := range d.QuickFixes(Range{Position{1, 1}, Position{10, 1}}, nil) {
		if f.Kind == "refactor.rewrite" {
			t.Errorf("rewrites a list operand: %q", f.Edits[0].NewText)
		}
	}
}

func TestIdentifierRefusal(t *testing.T) {
	for _, c := range []struct {
		kind, name string
		ok         bool
	}{
		{"variable", "Melee weave", true},
		{"variable", "a}b", false},
		{"placeholder", "a\nb", false},
		{"group", "a}b", true},
		{"sequence", "", false},
	} {
		if got := identifierRefusal(c.kind, c.name) == ""; got != c.ok {
			t.Errorf("identifierRefusal(%q, %q) is empty: %v", c.kind, c.name, got)
		}
	}
}

func readDisk(path string) ([]byte, error) { return os.ReadFile(path) }
