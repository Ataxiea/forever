//go:build with_db

package gen

import (
	"bytes"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"reflect"
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

// The committed file is in the generator's form, and a regeneration gives every entry of it back as it is: the
// name, its meaning and its registered-by list. What the sim and the database give beyond the table is only
// reported, since a database update or a class change adds names without changing what is committed, and make
// regenerates the table from them before anything reads it.
func TestTableKeepsItsEntries(t *testing.T) {
	old, data, c := committedTable(t)
	if got := old.Encode(); !bytes.Equal(got, data) {
		t.Errorf("%s is not in the generator's form; run %s and commit the table:\n  %s", TablePath, MakeCommand,
			strings.Join(append(missingLines(data, got, "+ "), missingLines(got, data, "- ")...), "\n  "))
	}
	names, report, err := Update(old, c, nil)
	if err != nil {
		t.Fatal(err)
	}
	var changed []string
	spellLike := func(scope string, old, now siml.SpellNames) {
		for _, ns := range slices.Sorted(maps.Keys(old)) {
			for _, name := range slices.Sorted(maps.Keys(old[ns])) {
				if e, g := old[ns][name], now[ns][name]; e.SpellID != g.SpellID || e.Tag != g.Tag || e.Rank != g.Rank || !slices.Equal(e.RegisteredBy, g.RegisteredBy) {
					changed = append(changed, fmt.Sprintf("%s.%s.%s is %+v, want %+v", scope, ns, name, g, e))
				}
			}
		}
	}
	for _, class := range slices.Sorted(maps.Keys(old.Classes)) {
		spellLike(scopeName(class), old.Classes[class], names.Classes[class])
	}
	spellLike("shared", old.Shared, names.Shared)
	for _, name := range slices.Sorted(maps.Keys(old.Items)) {
		if e, g := old.Items[name], names.Items[name]; e != g {
			changed = append(changed, fmt.Sprintf("item.%s is item %d, want item %d", name, g, e))
		}
	}
	for _, name := range slices.Sorted(maps.Keys(old.Enchants)) {
		if e, g := old.Enchants[name], names.Enchants[name]; !reflect.DeepEqual(e, g) {
			changed = append(changed, fmt.Sprintf("enchant.%s is %s, want %s", name, enchantText(g), enchantText(e)))
		}
	}
	for _, name := range slices.Sorted(maps.Keys(old.Suffixes)) {
		if e, g := old.Suffixes[name], names.Suffixes[name]; e != g {
			changed = append(changed, fmt.Sprintf("suffix.%s is suffix %d, want suffix %d", name, g, e))
		}
	}
	if len(changed) > 0 {
		t.Errorf("%s holds entries the sim and the database do not give now; run %s and commit the table:\n  %s",
			TablePath, MakeCommand, strings.Join(changed[:min(len(changed), 60)], "\n  "))
	}
	if len(report.Added) > 0 {
		t.Logf("%s lacks %d names the sim and the database give; %s adds them:\n  %s",
			TablePath, len(report.Added), MakeCommand, strings.Join(report.Added[:min(len(report.Added), 60)], "\n  "))
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
	added := slices.DeleteFunc(slices.Clone(report.Added), func(line string) bool { return !strings.HasPrefix(line, "warrior.spell.") })
	if want := []string{"warrior.spell.heroic_strike_tag1 = spell 25286 tag 1"}; !reflect.DeepEqual(added, want) {
		t.Errorf("the run added %v to warrior.spell, want heroic_strike_tag1 alone", added)
	}
}
