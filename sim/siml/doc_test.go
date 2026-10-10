package siml

import (
	"slices"
	"strings"
	"testing"
)

// Doc: what an editor reads of a file beyond Parse. TestAgreement compares its spans and refs with ui/sim/siml's.

var docText = textLines(
	"siml 1",
	"spec hunter",
	"",
	"var $burst = true",
	"",
	"priority:",
	"  cast multi_shot if $burst",
	"  cast rapid_fire",
)

func TestDocSpansAndPaths(t *testing.T) {
	d := Analyze(splicePath, []byte(docText), corpusNames(t), nil)
	if _, err := d.File(); err != nil {
		t.Fatal(err)
	}
	spans := d.Spans()
	has := func(path string, r Range) bool {
		return slices.ContainsFunc(spans, func(s PathSpan) bool { return agreePath(s.Path) == path && s.Range == r })
	}
	for _, c := range []struct {
		path string
		r    Range
	}{
		{"valueVariables/0", Range{Position{4, 1}, Position{4, 18}}},
		{"priorityList/0", Range{Position{7, 3}, Position{7, 28}}},
		{"priorityList/0/action/castSpell/spellId", Range{Position{7, 8}, Position{7, 18}}},
		{"priorityList/0/action/condition", Range{Position{7, 22}, Position{7, 28}}},
		{"priorityList/1", Range{Position{8, 3}, Position{8, 18}}},
	} {
		if !has(c.path, c.r) {
			t.Errorf("no span %s at %v", c.path, c.r)
		}
	}
	if got := agreePath(d.PathAt(Position{7, 25})); got != "priorityList/0/action/condition" {
		t.Errorf("the path at 7:25 is %s", got)
	}
	if r, ok := d.SpanFor([]any{"priorityList", 1, "action", "castSpell", "spellId", "spellId"}); !ok || r != (Range{Position{8, 8}, Position{8, 18}}) {
		t.Errorf("the span for the spell id of row 2 is %v, %t", r, ok)
	}
	if got := string(d.RotationJSON()); !strings.HasPrefix(got, `{"type":"TypeAPL","priorityList":[`) {
		t.Errorf("the rotation's JSON is %s", got)
	}
}

func TestDocWithErrors(t *testing.T) {
	d := Analyze(splicePath, []byte(strings.Replace(docText, "rapid_fire", "rapid_fir", 1)), corpusNames(t), nil)
	if _, err := d.File(); err == nil {
		t.Fatal("the file reads")
	}
	if d.RotationJSON() != nil {
		t.Error("a text with an error gives the rotation's JSON")
	}
	if diags := d.Diagnostics(); len(diags) != 1 || diags[0].Code != "unknown-name" {
		t.Errorf("the diagnostics are %v", diags)
	}
	refs := d.Refs()
	if len(refs) != 2 || !refs[0].Known || refs[1].Known || refs[1].Name != "rapid_fir" || agreePath(refs[1].Path) != "priorityList/1/action/castSpell/spellId" {
		t.Errorf("the refs are %+v", refs)
	}
	f, _ := d.File()
	if len(f.Names) != 1 {
		t.Errorf("the file's names are %+v", f.Names)
	}
}

func TestDocOffsets(t *testing.T) {
	text := "siml 1\nspec hunter\n// 😀 é x\n"
	d := Analyze(splicePath, []byte(text), corpusNames(t), nil)
	x := strings.Index(text, "x")
	if got := d.Position(x); got != (Position{3, 9}) {
		t.Errorf("x is at %v", got)
	}
	if got := d.Offset(Position{3, 9}); got != x {
		t.Errorf("3:9 is offset %d, not %d", got, x)
	}
	if got := d.Offset(Position{2, 99}); got != strings.Index(text, "\n//") {
		t.Errorf("a column past its line's end is offset %d", got)
	}
}

func TestDocSections(t *testing.T) {
	d := Analyze(splicePath, []byte(docText), corpusNames(t), nil)
	sections := d.Sections()
	if len(sections) != 2 || sections[0].Name != "apl" || sections[0].Header != nil || sections[1].Name != "priority" {
		t.Fatalf("the sections are %+v", sections)
	}
	if want := (Range{Position{6, 1}, Position{8, 18}}); sections[1].Range != want || *sections[1].Header != (Range{Position{6, 1}, Position{6, 10}}) {
		t.Errorf("priority: is at %v, its header at %v", sections[1].Range, *sections[1].Header)
	}
}
