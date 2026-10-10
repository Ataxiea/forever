package siml

import (
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"

	"github.com/wowsims/forever/sim/core/proto"
)

// Which sections a file holds, from its double extension (SPEC.md §1).
type Kind struct {
	Section string // The section an x.<section>.siml holds, such as apl or gear; "" for a full setup, x.siml.
}

// The kind of the file at path. A path that does not end in .siml, or whose double extension names no section,
// is an error.
func KindOf(path string) (Kind, error) {
	if !strings.HasSuffix(path, ".siml") {
		return Kind{}, fmt.Errorf("%s is not a .siml file", path)
	}
	k := kindOf(path)
	if k.Section == "" {
		return k, nil
	}
	ix, err := loadIndex()
	if err != nil {
		return Kind{}, err
	}
	if ix.sections[k.Section] == nil {
		return Kind{}, fmt.Errorf("%s: the file name names no section: %s", path, k.Section)
	}
	return k, nil
}

// The kind a path's double extension gives; text with no file name, or one not ending in .siml, is a full setup.
func kindOf(path string) Kind {
	base := path[strings.LastIndexAny(path, `/\`)+1:]
	stem, ok := strings.CutSuffix(base, ".siml")
	if !ok {
		return Kind{}
	}
	if dot := strings.LastIndexByte(stem, '.'); dot > 0 && dot < len(stem)-1 {
		return Kind{Section: stem[dot+1:]}
	}
	return Kind{}
}

// Reads a file that a use line names, at a path resolved against the using file.
type Opener func(path string) ([]byte, error)

// A name a file writes, and what it means there (SPEC.md §7).
type NameRef struct {
	Name       string
	Namespace  Namespace
	Start, End Position
	ID         int32    // The spell id, item id, enchant effect id or random suffix id it means.
	Row        *SlotRow // The slot row it is written on, if any.
}

// A slot row: its slot, and the item its suffix and enchant are on.
type SlotRow struct {
	Slot proto.ItemSlot
	Item int32
}

// A parsed file. One with an error holds no settings, categories or warnings, and still lists the names and raw refs
// that read.
type File struct {
	Path       string
	Kind       Kind
	Spec       proto.Spec                   // SpecUnknown when the file names no spec.
	Settings   *proto.IndividualSimSettings // What the file and the files it uses set (SPEC.md §5.1).
	Categories []string                     // The import categories the file holds, in the site's order (SPEC.md §5.1).
	Names      []NameRef                    // The names the file itself writes, in file order.
	RawRefs    Diagnostics                  // raw-ref at each raw token that holds an id a name could write, which no file under ui/specs holds (SPEC.md §7.3).
	Warnings   Diagnostics
}

// The rotation of an x.apl.siml, or of a full file that holds one.
func (f *File) Rotation() *proto.APLRotation { return f.Settings.GetPlayer().GetRotation() }

// The 17 items of an x.gear.siml, or of a full file that holds gear:.
func (f *File) Equipment() *proto.EquipmentSpec { return f.Settings.GetPlayer().GetEquipment() }

// Parses src, the text of the file at path, whose names mean what names says (SPEC.md §7). The error is Diagnostics
// when the file has an error, which then holds its warnings too, and the file holds what read. open reads the files
// that use lines name, at paths read against path; with no open, a use line is use-refused.
func Parse(path string, src []byte, names *Names, open Opener) (*File, error) {
	ix, err := loadIndex()
	if err != nil {
		return nil, err
	}
	kind := kindOf(path)
	self := resolveUse("", path)
	typed := readFile(ix, names, sourceText(src), kind, &uses{refused: open == nil, path: self, open: open, chain: []string{self}})
	lines := typed.tree.lines
	f := &File{Path: path, Kind: kind}
	if typed.spec != nil {
		f.Spec = typed.spec.Spec
	}
	refs := typed.typer.refs
	slices.SortFunc(refs, func(a, b nameRef) int { return a.start - b.start })
	for _, r := range refs {
		f.Names = append(f.Names, NameRef{
			Name:      r.name,
			Namespace: r.ns,
			Start:     lines.position(r.start),
			End:       lines.position(r.end),
			ID:        r.id,
			Row:       r.row,
		})
	}
	var raw []diag
	for _, at := range typed.typer.rawRefs {
		raw = append(raw, errorAt("raw-ref", "a file under ui/specs writes ids by name: format writes the names the table holds, and make sim/siml/names.json names what the sim registers", at))
	}
	f.RawRefs = lines.diagnostics(path, raw)
	diags := lines.diagnostics(path, typed.diags)
	if hasError(typed.diags) {
		return f, diags
	}
	f.Settings, f.Categories, f.Warnings = typed.settings, typed.categories, diags
	return f, nil
}

// Reads and parses the file at path with the committed name table, reading the files its use lines name from the
// file system. A build without the with_db tag holds no table, and reads only a file that writes no name.
func ReadFile(path string) (*File, error) {
	src, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	names, noTable := DefaultNames()
	if noTable != nil {
		names = &Names{}
	}
	f, err := Parse(path, src, names, os.ReadFile)
	var diags Diagnostics
	if noTable != nil && errors.As(err, &diags) && slices.ContainsFunc(diags, func(d Diagnostic) bool { return d.Code == "unknown-name" }) {
		return nil, fmt.Errorf("%s writes names: %w", path, noTable)
	}
	return f, err
}
