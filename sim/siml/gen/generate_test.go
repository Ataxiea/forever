//go:build with_db

package gen

import (
	"bytes"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/wowsims/forever/sim/core/proto"
	"github.com/wowsims/forever/sim/siml"
)

const root = "../../.."

var committed = sync.OnceValues(func() ([]byte, error) { return os.ReadFile(filepath.Join(root, TablePath)) })

// One collection for every test here: building every spec takes a few seconds.
var collected = sync.OnceValues(func() (*Collection, error) {
	data, err := committed()
	if err != nil {
		return nil, err
	}
	old, err := siml.ParseNames(data)
	if err != nil {
		return nil, err
	}
	return Collect(root, old)
})

func committedTable(t *testing.T) (*siml.Names, []byte, *Collection) {
	t.Helper()
	data, err := committed()
	if err != nil {
		t.Fatal(err)
	}
	old, err := siml.ParseNames(data)
	if err != nil {
		t.Fatalf("%s: %v", TablePath, err)
	}
	c, err := collected()
	if err != nil {
		t.Fatal(err)
	}
	return old, data, c
}

// The lines of b that a does not hold, each with prefix.
func missingLines(a, b []byte, prefix string) []string {
	have := map[string]bool{}
	for _, line := range strings.Split(string(a), "\n") {
		have[strings.TrimSuffix(strings.TrimSpace(line), ",")] = true
	}
	var out []string
	for _, line := range strings.Split(string(b), "\n") {
		if key := strings.TrimSuffix(strings.TrimSpace(line), ","); !have[key] {
			out = append(out, prefix+key)
		}
	}
	return out
}

func TestTableIsUpToDate(t *testing.T) {
	old, data, c := committedTable(t)
	names, report, err := Update(old, c, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := names.Encode(); !bytes.Equal(got, data) {
		var b strings.Builder
		b.WriteString(TablePath + " is not what the sim and the database give now. Run " + MakeCommand + " and commit the table.")
		if len(report.Added) > 0 {
			b.WriteString("\nnew entries:")
			for _, line := range report.Added[:min(len(report.Added), 60)] {
				b.WriteString("\n  " + line)
			}
		}
		b.WriteString("\nchanged lines:")
		diff := append(missingLines(data, got, "+ "), missingLines(got, data, "- ")...)
		for _, line := range diff[:min(len(diff), 60)] {
			b.WriteString("\n  " + line)
		}
		t.Error(b.String())
	}
}

func TestGenerateIsDeterministic(t *testing.T) {
	old, _, _ := committedTable(t)
	var runs [][]byte
	for range 2 {
		c, err := Collect(root, old)
		if err != nil {
			t.Fatal(err)
		}
		// From an empty table every name is new, so the whole run is compared, not only what the table lacks.
		names, _, err := Update(&siml.Names{}, c, nil)
		if err != nil {
			t.Fatal(err)
		}
		runs = append(runs, names.Encode())
	}
	if !bytes.Equal(runs[0], runs[1]) {
		t.Errorf("two runs differ:\n%s", strings.Join(append(missingLines(runs[0], runs[1], "+ "), missingLines(runs[1], runs[0], "- ")...), "\n"))
	}
}

// A pinned name keeps its meaning when the sim stops registering it, and the spell it would name now takes another
// name.
func TestPinnedNamesSurviveTheSim(t *testing.T) {
	old, _, c := committedTable(t)
	heroic := old.Classes[proto.Class_ClassWarrior][siml.NamespaceSpell]["heroic_strike"]
	if heroic.SpellID != 25286 || heroic.Tag != 1 {
		t.Fatalf("warrior.spell.heroic_strike is %+v, want spell 25286 tag 1", heroic)
	}
	pinned := &siml.Names{Classes: maps.Clone(old.Classes), Shared: old.Shared, Items: old.Items, Enchants: old.Enchants, Suffixes: old.Suffixes}
	pinned.Classes[proto.Class_ClassWarrior] = maps.Clone(old.Classes[proto.Class_ClassWarrior])
	spells := maps.Clone(old.Classes[proto.Class_ClassWarrior][siml.NamespaceSpell])
	spells["heroic_strike"] = siml.SpellName{SpellID: 25286, Tag: 7}
	pinned.Classes[proto.Class_ClassWarrior][siml.NamespaceSpell] = spells

	names, report, err := Update(pinned, c, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := names.Classes[proto.Class_ClassWarrior][siml.NamespaceSpell]
	if e := got["heroic_strike"]; e.SpellID != 25286 || e.Tag != 7 || len(e.RegisteredBy) != 0 {
		t.Errorf("heroic_strike is %+v, want the pinned spell 25286 tag 7 with no registered-by", e)
	}
	if e := got["heroic_strike_tag1"]; e.SpellID != 25286 || e.Tag != 1 || !slices.Contains(e.RegisteredBy, "dps_warrior") {
		t.Errorf("heroic_strike_tag1 is %+v, want the registered spell 25286 tag 1", e)
	}
	if !slices.Contains(report.Stale, "warrior.spell.heroic_strike is pinned to spell 25286 tag 7; the sim registers spell 25286, spell 25286 tag 1") {
		t.Errorf("the report does not name the stale heroic_strike: %v", report.Stale)
	}
	for name, e := range spells {
		if g, ok := got[name]; !ok || g.SpellID != e.SpellID || g.Tag != e.Tag || g.Rank != e.Rank {
			t.Errorf("warrior.spell.%s is %+v, want its pinned %+v", name, g, e)
		}
	}
	if len(report.Added) != 1 {
		t.Errorf("the run added %v, want heroic_strike_tag1 alone", report.Added)
	}
}
