package cmd

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"unicode"

	"github.com/wowsims/forever/assets/database"
	"github.com/wowsims/forever/sim/core"
	"github.com/wowsims/forever/sim/core/proto"
	"github.com/wowsims/forever/sim/siml"
)

// The part of the repository check of sim/siml/SPEC.md §7.4 that needs the sim and the database, for a file under
// ui/specs that reads: it names a spec of the class whose folder it is in, and uses only names that still hold:
// spells and auras its spec registers, items the database holds, enchants that fit their slots and items, and random
// suffixes their items offer.

// What the check reads from the database.
type gameData struct {
	items    map[int32]bool    // Every item, consumable and item icon.
	suffixes map[int32][]int32 // Each item's random suffix options.
}

func loadGameData() *gameData {
	db := database.Load()
	g := &gameData{items: map[int32]bool{}, suffixes: map[int32][]int32{}}
	for _, it := range db.Items {
		g.items[it.Id] = true
		g.suffixes[it.Id] = append(g.suffixes[it.Id], it.RandomSuffixOptions...)
	}
	for _, c := range db.Consumables {
		g.items[c.Id] = true
	}
	for _, icon := range db.ItemIcons {
		g.items[icon.Id] = true
	}
	return g
}

// The word a slot row writes for slot: ItemSlotMainHand is main_hand.
func slotWord(slot proto.ItemSlot) string {
	var b strings.Builder
	for i, r := range strings.TrimPrefix(slot.String(), "ItemSlot") {
		if unicode.IsUpper(r) {
			if i > 0 {
				b.WriteByte('_')
			}
			r = unicode.ToLower(r)
		}
		b.WriteRune(r)
	}
	return b.String()
}

// "a", "a and b", "a, b and c".
func listedNames(names []string) string {
	if len(names) < 2 {
		return strings.Join(names, "")
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}

// The class folder of a path under ui/specs: hunter for ui/specs/hunter/dps/apls/default.apl.siml, and "" for a file
// in no folder of ui/specs.
func classFolder(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		return ""
	}
	_, rest, _ := strings.Cut(filepath.ToSlash(abs), "/ui/specs/")
	folder, _, inFolder := strings.Cut(rest, "/")
	if !inFolder {
		return ""
	}
	return folder
}

// What is wrong with the file at path under ui/specs, which reads as f with names, each "path:line:col: what" or
// "path: what".
func repositoryProblems(names *siml.Names, game *gameData, path string, f *siml.File) []string {
	var problems []string
	spec, class := "", proto.Class_ClassUnknown
	if info, ok := siml.SpecOf(f.Spec); ok {
		spec, class = string(info.Field.Name()), info.Class
	}
	if folder := classFolder(path); class != proto.Class_ClassUnknown && folder != siml.ClassName(class) {
		problems = append(problems, fmt.Sprintf("%s: spec %s is a %s spec, and the file is not under ui/specs/%s", path, spec, siml.ClassName(class), siml.ClassName(class)))
	}
	for _, r := range f.Names {
		at := fmt.Sprintf("%s:%d:%d", path, r.Start.Line, r.Start.Col)
		switch r.Namespace {
		case siml.NamespaceItem:
			if !game.items[r.ID] {
				problems = append(problems, fmt.Sprintf("%s: the database holds no item %d, which %s names", at, r.ID, r.Name))
			}
		case siml.NamespaceEnchant:
			if r.Row == nil {
				break
			}
			if !slices.Contains(names.Enchants[r.Name].Slots, r.Row.Slot) {
				problems = append(problems, fmt.Sprintf("%s: %s does not fit the %s slot", at, r.Name, slotWord(r.Row.Slot)))
			} else if item := core.GetItemByID(r.Row.Item); item != nil && !core.EnchantAppliesToItem(r.ID, *item) {
				name, _ := names.ItemName(r.Row.Item)
				problems = append(problems, fmt.Sprintf("%s: %s does not fit %s", at, r.Name, name))
			}
		case siml.NamespaceSuffix:
			if r.Row != nil && !slices.Contains(game.suffixes[r.Row.Item], r.ID) {
				item, _ := names.ItemName(r.Row.Item)
				problems = append(problems, fmt.Sprintf("%s: %s is no random suffix of %s", at, r.Name, item))
			}
		default:
			entry, ok := names.Classes[class][r.Namespace][r.Name]
			if !ok {
				entry = names.Shared[r.Namespace][r.Name]
			}
			switch {
			case len(entry.RegisteredBy) == 0:
				problems = append(problems, fmt.Sprintf("%s: no spec registers the %s %s", at, r.Namespace, r.Name))
			case spec != "" && !slices.Contains(entry.RegisteredBy, spec):
				problems = append(problems, fmt.Sprintf("%s: spec %s does not register the %s %s; %s register it",
					at, spec, r.Namespace, r.Name, listedNames(entry.RegisteredBy)))
			}
		}
	}
	return problems
}
