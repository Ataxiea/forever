package siml

import (
	"cmp"
	"encoding/json"
	"errors"
	"reflect"
	"slices"

	"google.golang.org/protobuf/encoding/protojson"

	"github.com/wowsims/forever/sim/core/proto"
)

// Port: the edits that make the rotation an x.apl.siml or a full x.siml writes the rotation want, made as Splice
// makes them, so that only the rows, groups and variables that differ are printed again and every other line, def
// and when block stays as written. Rows are matched by what they read as, so a row put in or taken out moves no other.
func (d *Doc) Port(want *proto.APLRotation) ([]TextEdit, error) {
	f, err := d.rotationFile()
	if err != nil {
		return nil, err
	}
	have := &proto.APLRotation{}
	if err := protojson.Unmarshal(d.RotationJSON(), have); err != nil {
		return nil, err
	}
	before, err := portJSON(Normalize(have, d.names, d.class()).(*proto.APLRotation))
	if err != nil {
		return nil, err
	}
	after, err := portJSON(Normalize(want, d.names, d.class()).(*proto.APLRotation))
	if err != nil {
		return nil, err
	}
	var p porter
	for _, key := range unionKeys(before, after) {
		path := []any{key}
		if rowLists[key] {
			p.list(path, asList(before[key]), asList(after[key]))
		} else if !reflect.DeepEqual(before[key], after[key]) {
			p.set(path, after[key])
		}
	}
	if len(p.edits) == 0 {
		return nil, nil
	}
	return d.splice(f, p.edits)
}

// The lists whose elements are statements of their own, which a port puts in and takes out one by one.
var rowLists = map[string]bool{"prepullActions": true, "priorityList": true, "valueVariables": true, "groups": true}

// A group's lists of statements.
var groupLists = map[string]bool{"actions": true, "variables": true}

type porter struct{ edits []AplEdit }

func (p *porter) set(path []any, value any) {
	e := AplEdit{Op: "set", Path: slices.Clone(path)}
	if value != nil {
		e.Value, _ = json.Marshal(value)
	}
	p.edits = append(p.edits, e)
}

// The edits from a to b of a list of statements. Elements equal in both stay; in each stretch between them, the
// elements both sides hold are edited where they differ, the ones a has more of are taken out, and the ones b has
// more of are put in. The stretches go from the last, so an edit leaves the indices before it as they are.
func (p *porter) list(path []any, a, b []any) {
	pairs := commonElements(a, b)
	pairs = append(pairs, [2]int{len(a), len(b)})
	ends := [2]int{}
	type stretch struct{ i0, i1, j0, j1 int }
	var stretches []stretch
	for _, pair := range pairs {
		stretches = append(stretches, stretch{ends[0], pair[0], ends[1], pair[1]})
		ends = [2]int{pair[0] + 1, pair[1] + 1}
	}
	for _, s := range slices.Backward(stretches) {
		both := min(s.i1-s.i0, s.j1-s.j0)
		for i := s.i1 - 1; i >= s.i0+both; i-- {
			p.set(append(slices.Clone(path), i), nil)
		}
		for j := s.j1 - 1; j >= s.j0+both; j-- {
			value, _ := json.Marshal(b[j])
			p.edits = append(p.edits, AplEdit{Op: "insert", Path: slices.Clone(path), Index: s.i0 + both, Value: value})
		}
		for k := both - 1; k >= 0; k-- {
			p.value(append(slices.Clone(path), s.i0+k), a[s.i0+k], b[s.j0+k])
		}
	}
}

// The edits from a to b of one value: an object with the same fields is edited field by field, a group's lists
// statement by statement, and anything else is set whole.
func (p *porter) value(path []any, a, b any) {
	if reflect.DeepEqual(a, b) {
		return
	}
	am, aIsObject := a.(map[string]any)
	bm, bIsObject := b.(map[string]any)
	if aIsObject && bIsObject && (inGroups(path) || slices.Equal(unionKeys(am, nil), unionKeys(bm, nil))) {
		for _, key := range unionKeys(am, bm) {
			at := append(slices.Clone(path), key)
			switch {
			case inGroups(path) && groupLists[key]:
				p.list(at, asList(am[key]), asList(bm[key]))
			case inGroups(path) && (am[key] == nil || bm[key] == nil):
				p.set(at, bm[key])
			default:
				p.value(at, am[key], bm[key])
			}
		}
		return
	}
	al, aIsList := a.([]any)
	bl, bIsList := b.([]any)
	if aIsList && bIsList && len(al) == len(bl) {
		for i := range al {
			p.value(append(slices.Clone(path), i), al[i], bl[i])
		}
		return
	}
	p.set(path, b)
}

// Whether path leads to one group: ["groups", i].
func inGroups(path []any) bool {
	return len(path) == 2 && path[0] == "groups"
}

// The index pairs of a longest run of elements a and b hold in the same order.
func commonElements(a, b []any) [][2]int {
	lengths := make([][]int, len(a)+1)
	for i := range lengths {
		lengths[i] = make([]int, len(b)+1)
	}
	for i := len(a) - 1; i >= 0; i-- {
		for j := len(b) - 1; j >= 0; j-- {
			if reflect.DeepEqual(a[i], b[j]) {
				lengths[i][j] = lengths[i+1][j+1] + 1
			} else {
				lengths[i][j] = max(lengths[i+1][j], lengths[i][j+1])
			}
		}
	}
	var pairs [][2]int
	for i, j := 0, 0; i < len(a) && j < len(b); {
		switch {
		case reflect.DeepEqual(a[i], b[j]):
			pairs = append(pairs, [2]int{i, j})
			i, j = i+1, j+1
		case lengths[i+1][j] >= lengths[i][j+1]:
			i++
		default:
			j++
		}
	}
	return pairs
}

func unionKeys(a, b map[string]any) []string {
	var keys []string
	for k := range a {
		keys = append(keys, k)
	}
	for k := range b {
		if _, ok := a[k]; !ok {
			keys = append(keys, k)
		}
	}
	slices.Sort(keys)
	return keys
}

func asList(v any) []any {
	l, _ := v.([]any)
	return l
}

// The rotation as plain JSON values, which the port compares.
func portJSON(r *proto.APLRotation) (map[string]any, error) {
	text, err := protojson.Marshal(r)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(text, &out); err != nil {
		return nil, err
	}
	if out == nil {
		return nil, errors.New("the rotation reads as no JSON object")
	}
	return out, nil
}

// The edits that make the setup a full x.siml writes the setup want, its rotation left out: each import category
// (SPEC.md §5.1) that differs is printed again in place of the sections and talents line that write it, and every
// other line stays as written. left names each category that differs but that the file's own text does not write,
// as one a used file brings, which no edit here changes.
func (d *Doc) PortSetup(want *proto.IndividualSimSettings) (edits []TextEdit, left []string, err error) {
	f := d.typed
	switch {
	case f == nil || d.err != nil:
		return nil, nil, cmp.Or(d.err, errors.New("the text reads as no file"))
	case f.kind.Section != "":
		return nil, nil, errors.New("only a full x.siml writes a setup")
	}
	for _, c := range categories {
		if c == rotationCategory {
			continue
		}
		before := Print(f.kind, d.file.Spec, d.file.Settings, []string{c}, d.names)
		after := Print(f.kind, d.file.Spec, want, []string{c}, d.names)
		if string(before) == string(after) {
			continue
		}
		own := categorySpans(d.ix, f.tree, c)
		if len(own) == 0 {
			left = append(left, c)
			continue
		}
		printed, _ := parseSyntax(string(after), d.ix, f.kind)
		var text string
		for _, s := range categorySpans(d.ix, printed, c) {
			if text != "" {
				text += "\n\n"
			}
			text += string(after)[s.start:s.end]
		}
		edits = append(edits, TextEdit{Range{d.lines.position(own[0].start), d.lines.position(own[0].end)}, text})
		for _, s := range own[1:] {
			edits = append(edits, TextEdit{Range{d.lines.position(lineStartOf(d.src, s.start)), d.lines.position(min(s.end+1, len(d.src)))}, ""})
		}
	}
	slices.SortFunc(edits, func(a, b TextEdit) int { return cmp.Compare(d.Offset(a.Range.Start), d.Offset(b.Range.Start)) })
	return edits, left, nil
}

// The spans of the talents line, or of the sections, of tree that write the import category c.
func categorySpans(ix *schemaIndex, tree *syntaxTree, c string) []span {
	var out []span
	if c == talentsCategory {
		for _, s := range tree.top {
			if talents, ok := s.(*talentsStmt); ok {
				out = append(out, talents.span)
			}
		}
		return out
	}
	for _, s := range tree.sections {
		if def := ix.sections[s.name]; def != nil && def.Category == c {
			if at := sectionSpan(s); at.end > at.start {
				out = append(out, at)
			}
		}
	}
	return out
}
