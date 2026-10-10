package siml

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/wowsims/forever/sim/core/proto"
	"google.golang.org/protobuf/encoding/protojson"
	googleProto "google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// Edits to the rotation of an x.apl.siml, as the rotation panel makes them: each AplEdit changes the rotation JSON,
// and the text changes only where the JSON does. A statement an edit touches is printed again, with the // lines
// directly above it and its trailing comment (SPEC.md §10); a statement that moves takes its lines along; every other
// line stays as written. The new text is read back, and a statement that does not read as its JSON is printed again,
// or as raw JSON, until each one does.

const spliceRounds = 4 // A statement is read as written, then printed from its JSON, then written as raw JSON.

// An edit the rotation panel asks for, addressed by the JSON path, within the rotation, of what it changes.
type AplEdit struct {
	Op    string          `json:"op"`              // set, insert or move.
	Path  []any           `json:"path"`            // JSON names and list indices; insert's and move's name the list.
	Value json.RawMessage `json:"value,omitempty"` // set's new value, where none removes the property or element; insert's element.
	Index int             `json:"index,omitempty"` // Where insert puts its element.
	From  int             `json:"from,omitempty"`  // The element move takes.
	To    int             `json:"to,omitempty"`    // The index the moved element ends at.
}

// Text that takes the place of a range of a file's text.
type TextEdit struct {
	Range   Range
	NewText string
}

// The edits that apply edits, in order, to the rotation the text writes: only the statements they change are printed
// again, and every other line of the text is kept. The error says why not: the file is no x.apl.siml, the text has an
// error or uses another file, a path leads through an index or a field that does not exist, or the edited rotation has
// an error.
func (d *Doc) Splice(edits []AplEdit) ([]TextEdit, error) {
	f := d.typed
	if f == nil {
		return nil, d.err
	}
	if f.kind.Section != sectionAPL {
		return nil, errors.New("the panel edits the rotation of an x.apl.siml file")
	}
	if hasError(f.diags) {
		return nil, errors.New("the text has errors; fix them to edit the rotation")
	}
	for _, s := range f.tree.top {
		if use, ok := s.(*useStmt); ok {
			return nil, fmt.Errorf("the rotation is put together with %s; edit it as text", use.path.value)
		}
	}
	m := newRotationModel(d.ix, f)
	for _, e := range edits {
		if problem := m.apply(e); problem != "" {
			return nil, errors.New(problem)
		}
	}
	if problem := m.read(); problem != "" {
		return nil, errors.New(problem)
	}

	w := func() *spliceWriter { return newSpliceWriter(d, m) }
	if before := declaredBy(m.rotation).variables; !slices.Equal(before, declaredBy(m.json()).variables) {
		for _, s := range w().unsettled(before) {
			s.dirty = true
		}
	}
	for range spliceRounds {
		out := w().statements()
		back := readFile(d.ix, d.names, out.result(), f.kind, nil)
		// The forms the printer writes read back, so an error is the edited rotation's own: a cycle, or a name written
		// twice.
		for _, diag := range back.tree.lines.diagnostics("", back.diags) {
			if diag.Severity == Error {
				return nil, errors.New("the edited rotation has an error: " + diag.Message)
			}
		}
		got := back.settings.GetPlayer().GetRotation()
		var misread []*spliceSlot
		for _, list := range m.lists() {
			var read []protoreflect.Message
			if list.group == nil {
				read = elements(got.ProtoReflect(), list.key)
			} else if g := slices.Index(m.groups, list.group); g < len(got.GetGroups()) {
				read = elements(got.GetGroups()[g].ProtoReflect(), list.key)
			}
			for k, s := range list.slots {
				if len(read) != len(list.slots) || d.ix.comparedJSON(read[k]) != d.ix.comparedJSON(s.msg) {
					misread = append(misread, s)
				}
			}
		}
		if len(misread) == 0 {
			if d.ix.comparedJSON(got.ProtoReflect()) != d.ix.comparedJSON(m.json().ProtoReflect()) {
				break
			}
			changes := out.edits()
			edits := make([]TextEdit, len(changes))
			for i, c := range changes {
				edits[i] = TextEdit{Range: Range{d.lines.position(c.start), d.lines.position(c.end)}, NewText: c.text}
			}
			return edits, nil
		}
		if slices.ContainsFunc(misread, func(s *spliceSlot) bool { return s.raw }) {
			break
		}
		// A statement that does not read as its JSON is printed from it, and one printed already is written as raw JSON.
		for _, s := range misread {
			s.raw, s.dirty = s.dirty, true
		}
	}
	return nil, errors.New("the edited rotation does not read back as its JSON")
}

// The messages of the list field of m whose JSON name is key.
func elements(m protoreflect.Message, key string) []protoreflect.Message {
	fd := m.Descriptor().Fields().ByJSONName(key)
	list := m.Get(fd).List()
	out := make([]protoreflect.Message, list.Len())
	for i := range out {
		out[i] = list.Get(i).Message()
	}
	return out
}

// --- Lines

// A line of the new text: a line of the text as written, or a new one.
type spliceLine struct {
	text   string
	from   int  // The line of the text it is, -1 for a new one.
	header bool // A section header, which no blank line follows inside its section.
}

// The lines of a group's block, from the comments above its header to its last statement, which move as one.
type lineBlock struct{ first, last int }

type lineInsert struct {
	lines []spliceLine
	phase int        // At one line: the lines that close a block, then the others, then those that open a block.
	block *lineBlock // The block the lines belong to, which they move with.
}

var blankSpliceLine = spliceLine{from: -1}

func headerLine(text string) spliceLine { return spliceLine{text: text, from: -1, header: true} }

// A change by byte offsets of the text.
type offsetEdit struct {
	start, end int
	text       string
}

// Changes to a text by whole lines: lines dropped, lines put in front of a line, and blocks moved elsewhere with what
// changed inside them.
type lineEdits struct {
	src     string
	starts  []int
	eol     string
	ended   bool // Whether the text ends with a line break.
	count   int  // The text's lines; putting lines in front of line count puts them at its end.
	blanks  map[int]bool
	headers map[int]bool
	dropped map[int]bool
	inserts map[int][]lineInsert
	moved   map[*lineBlock]bool
}

func newLineEdits(src string, tree *syntaxTree) *lineEdits {
	_, triv, lines := lex(src)
	e := &lineEdits{
		src:     src,
		starts:  lines.starts,
		eol:     "\n",
		ended:   src == "" || strings.HasSuffix(src, "\n"),
		blanks:  map[int]bool{},
		headers: map[int]bool{},
		dropped: map[int]bool{},
		inserts: map[int][]lineInsert{},
		moved:   map[*lineBlock]bool{},
	}
	if strings.Contains(src, "\r\n") {
		e.eol = "\r\n"
	}
	e.count = len(e.starts)
	if e.ended {
		e.count--
	}
	for _, t := range triv {
		if t.kind == triviaBlank {
			e.blanks[t.line] = true
		}
	}
	for _, s := range tree.statements {
		if h, ok := s.(*headerStmt); ok && h.body == nil {
			e.headers[lines.line(h.start)] = true
		}
	}
	return e
}

// Line i as written, without its line break.
func (e *lineEdits) line(i int) string {
	end := len(e.src)
	if i+1 < len(e.starts) {
		end = e.starts[i+1] - 1
	}
	return strings.TrimSuffix(e.src[e.starts[i]:end], "\r")
}

// Lines first to last as written.
func (e *lineEdits) written(first, last int) []spliceLine {
	var out []spliceLine
	for i := first; i <= last; i++ {
		out = append(out, spliceLine{text: e.line(i), from: -1, header: e.headers[i]})
	}
	return out
}

func (e *lineEdits) drop(first, last int) {
	for i := first; i <= last; i++ {
		e.dropped[i] = true
	}
}

// Puts lines in front of line at, as lines of block when they belong to one.
func (e *lineEdits) insert(at int, lines []spliceLine, block *lineBlock) {
	phase := 1
	if block != nil {
		phase = 0
		if at == block.first {
			phase = 2
		}
	}
	here := append(e.inserts[at], lineInsert{lines: lines, phase: phase, block: block})
	slices.SortStableFunc(here, func(a, b lineInsert) int { return a.phase - b.phase })
	e.inserts[at] = here
}

// Takes block from its place, and gives its lines with the changes made inside it.
func (e *lineEdits) moveOut(block *lineBlock) []spliceLine {
	var out []spliceLine
	for i := block.first; i <= block.last+1; i++ {
		for _, x := range e.inserts[i] {
			if x.block == block {
				out = append(out, x.lines...)
			}
		}
		if i <= block.last && !e.dropped[i] {
			out = append(out, e.written(i, i)...)
		}
	}
	e.drop(block.first, block.last)
	e.moved[block] = true
	return out
}

// The edits that turn the text into the new one, each covering only lines that change.
func (e *lineEdits) edits() []offsetEdit {
	var out []offsetEdit
	prev := -1
	var pending []string
	flush := func(to int) {
		for _, c := range e.changes(prev+1, to, pending) {
			out = append(out, e.edit(c.from, c.to, c.lines))
		}
		pending = nil
	}
	for _, l := range e.sequence() {
		if l.from < 0 {
			pending = append(pending, l.text)
			continue
		}
		if l.from > prev+1 || len(pending) > 0 {
			flush(l.from)
		}
		prev = l.from
	}
	if prev+1 < e.count || len(pending) > 0 {
		flush(e.count)
	}
	return out
}

// The new text.
func (e *lineEdits) result() string {
	text := e.src
	for _, x := range slices.Backward(e.edits()) {
		text = text[:x.start] + x.text + text[x.end:]
	}
	return text
}

func (e *lineEdits) sequence() []spliceLine {
	var out []spliceLine
	for i := 0; i <= e.count; i++ {
		for _, x := range e.inserts[i] {
			if x.block == nil || !e.moved[x.block] {
				out = append(out, x.lines...)
			}
		}
		if i < e.count && !e.dropped[i] {
			out = append(out, spliceLine{text: e.line(i), from: i, header: e.headers[i]})
		}
	}
	return e.tidy(out)
}

// Blank lines as format writes them where the edits change what is around them: one between statements, and none
// between a header and the first statement of its section or at either end of the text. A run that has the same
// lines around it as in the text stays as written.
func (e *lineEdits) tidy(lines []spliceLine) []spliceLine {
	blank := func(l spliceLine) bool {
		if l.from >= 0 {
			return e.blanks[l.from]
		}
		return strings.TrimSpace(l.text) == ""
	}
	comment := func(l spliceLine) bool { return strings.HasPrefix(strings.TrimLeftFunc(l.text, isJSSpace), "//") }
	var out []spliceLine
	for i := 0; i < len(lines); {
		if !blank(lines[i]) {
			out = append(out, lines[i])
			i++
			continue
		}
		j := i
		for j < len(lines) && blank(lines[j]) {
			j++
		}
		run := lines[i:j]
		var before, after, next *spliceLine
		if i > 0 {
			before = &lines[i-1]
		}
		if j < len(lines) {
			after = &lines[j]
		}
		for k := j; k < len(lines); k++ {
			if !blank(lines[k]) && !comment(lines[k]) {
				next = &lines[k]
				break
			}
		}
		switch {
		case e.asWritten(run, before, after):
			out = append(out, run...)
		case before != nil && after != nil && !(before.header && next != nil && !next.header):
			kept := run[0]
			if k := slices.IndexFunc(run, func(l spliceLine) bool { return l.from >= 0 }); k >= 0 {
				kept = run[k]
			}
			out = append(out, kept)
		}
		i = j
	}
	return out
}

func (e *lineEdits) asWritten(run []spliceLine, before, after *spliceLine) bool {
	first := run[0].from
	for k, l := range run {
		if first < 0 || l.from != first+k {
			return false
		}
	}
	last := first + len(run) - 1
	return (before == nil && first == 0 || before != nil && first > 0 && before.from == first-1) &&
		(after == nil && last == e.count-1 || after != nil && after.from == last+1)
}

// Lines in place of the text's lines from to to, exclusive.
type lineChange struct {
	from, to int
	lines    []string
}

// Where lines differ from the text's lines from to to (exclusive), which they replace: each run of lines that is not
// in their longest common run, as the text's lines it replaces and the lines that go in their place.
func (e *lineEdits) changes(from, to int, lines []string) []lineChange {
	old := make([]string, to-from)
	for k := range old {
		old[k] = e.line(from + k)
	}
	common := make([][]int, len(old)+1)
	for i := range common {
		common[i] = make([]int, len(lines)+1)
	}
	for i := len(old) - 1; i >= 0; i-- {
		for j := len(lines) - 1; j >= 0; j-- {
			if old[i] == lines[j] {
				common[i][j] = common[i+1][j+1] + 1
			} else {
				common[i][j] = max(common[i+1][j], common[i][j+1])
			}
		}
	}
	var out []lineChange
	open := false // Whether the last line looked at is in a change.
	for i, j := 0, 0; i < len(old) || j < len(lines); {
		if i < len(old) && j < len(lines) && old[i] == lines[j] {
			i, j, open = i+1, j+1, false
			continue
		}
		if !open {
			out, open = append(out, lineChange{from: from + i, to: from + i}), true
		}
		change := &out[len(out)-1]
		if j < len(lines) && (i == len(old) || common[i][j+1] >= common[i+1][j]) {
			change.lines = append(change.lines, lines[j])
			j++
		} else {
			i++
			change.to = from + i
		}
	}
	return out
}

// The edit that puts lines in place of the text's lines from to to (exclusive).
func (e *lineEdits) edit(from, to int, lines []string) offsetEdit {
	offset := func(i int) int {
		if i < len(e.starts) {
			return e.starts[i]
		}
		return len(e.src)
	}
	var text string
	// At the end of a text with no final line break, the lines are joined, and follow a line break of their own.
	if to == e.count && !e.ended {
		if from == to && len(lines) > 0 {
			text = e.eol
		}
		text += strings.Join(lines, e.eol)
	} else {
		for _, l := range lines {
			text += l + e.eol
		}
	}
	return offsetEdit{start: offset(from), end: offset(to), text: text}
}

// --- The rotation as the edits leave it

// A statement's lines: the comment and note lines directly above it, with no blank line between, and its own.
type spliceUnit struct {
	statement   stmt
	first, last int
	comments    []trivia    // The comment lines directly above it.
	header      *headerStmt // The header whose line it is written on.
}

// An element of a rotation list: a row or a var line.
type spliceSlot struct {
	json  any                  // Its JSON, as the edits leave it.
	msg   protoreflect.Message // What json reads as; nil until read.
	unit  *spliceUnit          // Its statement in the text.
	dirty bool                 // Printed again, as every slot the text does not hold is.
	raw   bool                 // Printed as raw JSON, which only a dirty slot is.
}

type spliceList struct {
	key     string // Its JSON name in the rotation or the group.
	message protoreflect.MessageDescriptor
	row     bool // Rows, else var lines.
	prepull bool
	group   *spliceGroup
	section *section // Its section in the text.
	indent  int
	old     []*spliceSlot // Its elements in the text, in their order.
	slots   []*spliceSlot // Its elements as the edits leave them.
}

type spliceGroup struct {
	name      string
	renamed   bool
	header    *headerStmt // Its header in the text.
	block     *lineBlock
	variables *spliceList
	actions   *spliceList
}

type rotationModel struct {
	ix       *schemaIndex
	lines    *lineMap
	rotation *proto.APLRotation // The rotation the text writes.
	own      []*spliceList      // The value variables, the prepull rows and the priority rows.
	groups   []*spliceGroup
	old      []*spliceGroup
}

func unitOf(s stmt, header *headerStmt, lines *lineMap) *spliceUnit {
	b := s.base()
	line := lines.line(b.start)
	if header != nil {
		return &spliceUnit{statement: s, first: line, last: lines.line(header.end), header: header}
	}
	above := slices.Clone(b.leading)
	if r, ok := s.(*rowStmt); ok {
		above = append(above, r.notes...)
	}
	slices.SortStableFunc(above, func(a, b trivia) int { return a.start - b.start })
	first := line
	for k := len(above) - 1; k >= 0 && above[k].kind != triviaBlank && above[k].line == first-1; k-- {
		first--
	}
	comments := slices.DeleteFunc(above, func(t trivia) bool { return t.kind != triviaComment || t.line < first })
	return &spliceUnit{statement: s, first: first, last: lines.line(b.end), comments: comments}
}

// The last line of a section's header and statements.
func lastLine(s *section, lines *lineMap) int {
	last := -1
	if s.header != nil {
		last = lines.line(s.header.end)
	}
	for _, b := range s.body {
		last = max(last, lines.line(b.base().end))
	}
	return last
}

// The column a statement starts at.
func columnOf(s stmt, lines *lineMap) int {
	start := s.base().start
	return start - lines.starts[lines.line(start)]
}

func newRotationModel(ix *schemaIndex, f *typedFile) *rotationModel {
	lines := f.tree.lines
	m := &rotationModel{ix: ix, lines: lines, rotation: f.settings.GetPlayer().GetRotation()}
	if m.rotation == nil {
		m.rotation = &proto.APLRotation{}
	}
	statements := map[string]stmt{}
	for s, path := range f.paths {
		statements[pathKey(path)] = s
	}
	headers := map[stmt]*headerStmt{}
	for _, s := range f.tree.statements {
		if h, ok := s.(*headerStmt); ok && h.body != nil {
			headers[h.body] = h
		}
	}
	// A list's elements in the text, each with its statement, and the indent its statements have.
	fill := func(list *spliceList, holder protoreflect.Message, path ...any) {
		for i, msg := range elements(holder, list.key) {
			s := statements[pathKey(slices.Concat(path, []any{list.key, i}))]
			v, _ := decodeJSON([]byte(ix.jsonText(msg)))
			list.old = append(list.old, &spliceSlot{json: v, msg: msg, unit: unitOf(s, headers[s], lines)})
		}
		list.slots = slices.Clone(list.old)
		if k := slices.IndexFunc(list.old, func(s *spliceSlot) bool { return s.unit.header == nil }); k >= 0 {
			list.indent = columnOf(list.old[k].unit.statement, lines)
		}
	}
	sectionNamed := func(name string) *section {
		if k := slices.IndexFunc(f.tree.sections, func(s *section) bool { return s.name == name }); k >= 0 {
			return f.tree.sections[k]
		}
		return nil
	}
	rotation := m.rotation.ProtoReflect()
	m.own = []*spliceList{
		newSpliceList("valueVariables", false, false, f.tree.sections[0]),
		newSpliceList("prepullActions", true, true, sectionNamed(sectionPrepull)),
		newSpliceList("priorityList", true, false, sectionNamed(sectionPriority)),
	}
	for _, list := range m.own {
		fill(list, rotation)
	}
	for _, s := range f.tree.sections {
		if s.name != sectionGroup || s.group == nil {
			continue
		}
		g := len(m.old)
		group := m.group(s.group.value, false, s)
		holder := m.rotation.Groups[g].ProtoReflect()
		fill(group.variables, holder, "groups", g)
		fill(group.actions, holder, "groups", g)
		m.old = append(m.old, group)
	}
	m.groups = slices.Clone(m.old)
	return m
}

func pathKey(path []any) string { return fmt.Sprint(path) }

func decodeJSON(text []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(text))
	dec.UseNumber()
	var v any
	err := dec.Decode(&v)
	return v, err
}

func newSpliceList(key string, row, prepull bool, s *section) *spliceList {
	message := (&proto.APLValueVariable{}).ProtoReflect().Descriptor()
	switch {
	case prepull:
		message = prepullMessage
	case row:
		message = listItemMessage
	}
	indent := 0
	if s == nil || s.header != nil {
		indent = indentWidth
	}
	return &spliceList{key: key, message: message, row: row, prepull: prepull, section: s, indent: indent}
}

// A group, from its section in the text, or with none for a new one.
func (m *rotationModel) group(name string, renamed bool, s *section) *spliceGroup {
	g := &spliceGroup{name: name, renamed: renamed}
	g.variables = newSpliceList("variables", false, false, s)
	g.actions = newSpliceList("actions", true, false, s)
	g.variables.group, g.actions.group = g, g
	if s != nil {
		g.header = s.header
		g.block = &lineBlock{first: unitOf(s.header, nil, m.lines).first, last: lastLine(s, m.lines)}
	}
	return g
}

// A group the text does not hold, from its JSON.
func (m *rotationModel) newGroup(value any) *spliceGroup {
	object, _ := value.(map[string]any)
	name, _ := object["name"].(string)
	g := m.group(name, true, nil)
	g.variables.slots = newSlots(object["variables"])
	g.actions.slots = newSlots(object["actions"])
	return g
}

func newSlots(value any) []*spliceSlot {
	items, _ := value.([]any)
	out := make([]*spliceSlot, len(items))
	for i, item := range items {
		out[i] = newSlot(item)
	}
	return out
}

func newSlot(value any) *spliceSlot { return &spliceSlot{json: cloneJSON(value), dirty: true} }

// Every list of rows and var lines, as the edits leave them.
func (m *rotationModel) lists() []*spliceList {
	out := slices.Clone(m.own)
	for _, g := range m.groups {
		out = append(out, g.variables, g.actions)
	}
	return out
}

// Reads each slot's JSON as its message; gives why not when one does not read.
func (m *rotationModel) read() string {
	for _, list := range m.lists() {
		for _, s := range list.slots {
			if s.msg != nil {
				continue
			}
			text, err := json.Marshal(s.json)
			msg := newMessage(list.message)
			problem := ""
			if err != nil {
				problem = err.Error()
			} else {
				problem = m.ix.readJSON(string(text), msg, protojson.UnmarshalOptions{DiscardUnknown: true})
			}
			if problem != "" {
				return fmt.Sprintf("the edited rotation has an element that is no %s: %s", typeName(list.message.FullName()), problem)
			}
			s.msg = msg
		}
	}
	return ""
}

// The rotation the slots hold.
func (m *rotationModel) json() *proto.APLRotation {
	r := googleProto.Clone(m.rotation).(*proto.APLRotation)
	r.ValueVariables = slotMessages[*proto.APLValueVariable](m.own[0])
	r.PrepullActions = slotMessages[*proto.APLPrepullAction](m.own[1])
	r.PriorityList = slotMessages[*proto.APLListItem](m.own[2])
	r.Groups = nil
	for _, g := range m.groups {
		r.Groups = append(r.Groups, &proto.APLGroup{
			Name:      g.name,
			Variables: slotMessages[*proto.APLValueVariable](g.variables),
			Actions:   slotMessages[*proto.APLListItem](g.actions),
		})
	}
	return r
}

func slotMessages[T googleProto.Message](list *spliceList) []T {
	var out []T
	for _, s := range list.slots {
		out = append(out, s.msg.Interface().(T))
	}
	return out
}

// What a path names: a list of rows or var lines, one of their elements with a path inside it, the list of groups, a
// group, or a group's name.
type spliceTarget struct {
	list   *spliceList
	index  int // The element of list, -1 for the list.
	rest   []any
	groups bool
	group  int // -1 for none.
	name   bool
}

func (m *rotationModel) locate(path []any) (spliceTarget, string) {
	t := spliceTarget{index: -1, group: -1}
	element := func(list *spliceList, at int) (spliceTarget, string) {
		t.list = list
		if at < len(path) {
			i, ok := pathIndex(path[at], len(list.slots))
			if !ok {
				return t, describePath(path[:at+1]) + " does not exist"
			}
			t.index, t.rest = i, path[at+1:]
		}
		return t, ""
	}
	if len(path) > 0 && path[0] == "groups" {
		if len(path) == 1 {
			t.groups = true
			return t, ""
		}
		g, ok := pathIndex(path[1], len(m.groups))
		if !ok {
			return t, describePath(path[:2]) + " does not exist"
		}
		switch {
		case len(path) == 2:
			t.group = g
			return t, ""
		case path[2] == "name" && len(path) == 3:
			t.group, t.name = g, true
			return t, ""
		case path[2] == "variables":
			return element(m.groups[g].variables, 3)
		case path[2] == "actions":
			return element(m.groups[g].actions, 3)
		}
	} else if len(path) > 0 {
		for _, list := range m.own {
			if path[0] == list.key {
				return element(list, 1)
			}
		}
	}
	return t, describePath(path) + " is not in a row, var line or group, which are what the panel edits"
}

// Applies one edit; gives why not when its path leads nowhere, or to something other than rows, var lines and groups.
func (m *rotationModel) apply(e AplEdit) string {
	t, problem := m.locate(e.Path)
	if problem != "" {
		return problem
	}
	path := e.Path
	has := len(e.Value) > 0
	var value any
	if has {
		v, err := decodeJSON(e.Value)
		if err != nil {
			return fmt.Sprintf("the value for %s is no JSON: %v", describePath(path), err)
		}
		value = v
	}
	_, isList := value.([]any)
	if e.Op == "set" {
		switch {
		case t.groups:
			if has && !isList {
				return describePath(path) + " takes a list of groups"
			}
			items, _ := value.([]any)
			m.groups = nil
			for _, item := range items {
				m.groups = append(m.groups, m.newGroup(item))
			}
		case t.group >= 0:
			group := m.groups[t.group]
			name, isString := value.(string)
			_, isObject := value.(map[string]any)
			switch {
			case t.name && has && !isString:
				return describePath(path) + " takes a string"
			case !t.name && has && !isObject:
				return describePath(path) + " takes a group"
			case t.name:
				group.name, group.renamed = name, true
			case !has:
				m.groups = slices.Delete(m.groups, t.group, t.group+1)
			default:
				fresh := m.newGroup(value)
				group.name, group.renamed = fresh.name, true
				group.variables.slots, group.actions.slots = fresh.variables.slots, fresh.actions.slots
			}
		case t.index < 0:
			if has && !isList {
				return describePath(path) + " takes a list"
			}
			t.list.slots = newSlots(value)
		case len(t.rest) > 0:
			return changed(t.list.slots[t.index], func(root any) (any, string) { return setIn(root, t.rest, value, has, path) })
		case !has:
			t.list.slots = slices.Delete(t.list.slots, t.index, t.index+1)
		default:
			s := t.list.slots[t.index]
			s.json, s.msg, s.dirty = cloneJSON(value), nil, true
		}
		return ""
	}
	insert := e.Op == "insert"
	switch {
	case !insert && e.Op != "move":
		return fmt.Sprintf("no edit is named %q: an edit is set, insert or move", e.Op)
	case t.group >= 0:
		return describePath(path) + " is no list"
	case insert && !has:
		return "nothing to insert at " + describePath(slices.Concat(path, []any{e.Index}))
	case t.index >= 0 && insert:
		return changed(t.list.slots[t.index], func(root any) (any, string) { return insertIn(root, t.rest, e.Index, value, path) })
	case t.index >= 0:
		return changed(t.list.slots[t.index], func(root any) (any, string) {
			list, _ := jsonAt(root, t.rest)
			items, isList := list.([]any)
			if !isList {
				return root, describePath(path) + " is no list"
			}
			return root, moveIn(items, e.From, e.To, path)
		})
	case t.groups && insert:
		return insertAt(&m.groups, e.Index, m.newGroup(value), path)
	case t.groups:
		return moveIn(m.groups, e.From, e.To, path)
	case insert:
		return insertAt(&t.list.slots, e.Index, newSlot(value), path)
	}
	return moveIn(t.list.slots, e.From, e.To, path)
}

// Applies change to a slot's JSON, which the slot is then printed from.
func changed(s *spliceSlot, change func(any) (any, string)) string {
	root, problem := change(s.json)
	if problem == "" {
		s.json, s.msg, s.dirty = root, nil, true
	}
	return problem
}

func setIn(root any, rest []any, value any, has bool, path []any) (any, string) {
	at, key := rest[:len(rest)-1], rest[len(rest)-1]
	parent, _ := jsonAt(root, at)
	switch parent := parent.(type) {
	case []any:
		if i, ok := pathIndex(key, len(parent)); ok && has {
			parent[i] = cloneJSON(value)
			return root, ""
		} else if ok {
			return jsonPut(root, at, slices.Delete(parent, i, i+1)), ""
		}
	case map[string]any:
		if k, isString := key.(string); isString && has {
			parent[k] = cloneJSON(value)
			return root, ""
		} else if _, in := parent[k]; isString && in {
			delete(parent, k)
			return root, ""
		}
	}
	return root, describePath(path) + " does not exist"
}

func insertIn(root any, rest []any, index int, value any, path []any) (any, string) {
	list, ok := jsonAt(root, rest)
	if !ok && len(rest) > 0 && index == 0 {
		// A list a message leaves out is empty.
		parent, _ := jsonAt(root, rest[:len(rest)-1])
		object, isObject := parent.(map[string]any)
		if k, isString := rest[len(rest)-1].(string); isObject && isString {
			object[k] = []any{cloneJSON(value)}
			return root, ""
		}
	}
	items, isList := list.([]any)
	if !isList {
		return root, describePath(path) + " is no list"
	}
	if problem := insertAt(&items, index, cloneJSON(value), path); problem != "" {
		return root, problem
	}
	return jsonPut(root, rest, items), ""
}

// Puts x into list at index.
func insertAt[T any](list *[]T, index int, x T, path []any) string {
	if index < 0 || index > len(*list) {
		return fmt.Sprintf("%s holds %d, so nothing goes in at %d", describePath(path), len(*list), index)
	}
	*list = slices.Insert(*list, index, x)
	return ""
}

// Moves the element from of list to to, in place.
func moveIn[T any](list []T, from, to int, path []any) string {
	if from < 0 || from >= len(list) {
		return describePath(slices.Concat(path, []any{from})) + " does not exist"
	}
	if to < 0 || to >= len(list) {
		return fmt.Sprintf("%s holds %d, so nothing goes to %d", describePath(path), len(list), to)
	}
	x := list[from]
	if from < to {
		copy(list[from:], list[from+1:to+1])
	} else {
		copy(list[to+1:], list[to:from])
	}
	list[to] = x
	return ""
}

// The value at path, or false when the path leads through something it cannot.
func jsonAt(v any, path []any) (any, bool) {
	for _, k := range path {
		switch c := v.(type) {
		case map[string]any:
			name, ok := k.(string)
			if !ok {
				return nil, false
			}
			if v, ok = c[name]; !ok {
				return nil, false
			}
		case []any:
			i, ok := pathIndex(k, len(c))
			if !ok {
				return nil, false
			}
			v = c[i]
		default:
			return nil, false
		}
	}
	return v, true
}

// Puts v at path in root, a path jsonAt finds, and gives the new root.
func jsonPut(root any, path []any, v any) any {
	if len(path) == 0 {
		return v
	}
	switch c := root.(type) {
	case map[string]any:
		k := path[0].(string)
		c[k] = jsonPut(c[k], path[1:], v)
	case []any:
		i, _ := pathIndex(path[0], len(c))
		c[i] = jsonPut(c[i], path[1:], v)
	}
	return root
}

func cloneJSON(v any) any {
	switch c := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(c))
		for k, x := range c {
			out[k] = cloneJSON(x)
		}
		return out
	case []any:
		out := make([]any, len(c))
		for i, x := range c {
			out[i] = cloneJSON(x)
		}
		return out
	}
	return v
}

// A path key as a list index below length: a whole number, as Go or a JSON decoder gives it.
func pathIndex(k any, length int) (int, bool) {
	i, whole := -1, true
	switch n := k.(type) {
	case int:
		i = n
	case int32:
		i = int(n)
	case int64:
		i = int(n)
	case float64:
		i, whole = int(n), n == float64(int(n))
	case json.Number:
		x, err := n.Int64()
		i, whole = int(x), err == nil
	}
	return i, whole && i >= 0 && i < length
}

// A path as messages write it: priorityList[3].action.
func describePath(path []any) string {
	var b strings.Builder
	for i, k := range path {
		if _, isName := k.(string); !isName {
			fmt.Fprintf(&b, "[%v]", k)
			continue
		}
		if i > 0 {
			b.WriteByte('.')
		}
		fmt.Fprint(&b, k)
	}
	return b.String()
}

// --- Writing the new text

// The elements of now that keep their places: the longest run of them in the order old gives them.
func stable[T comparable](now, old []T) map[T]bool {
	order := make([]int, len(now))
	length := make([]int, len(now))
	prev := make([]int, len(now))
	best := -1
	for i, x := range now {
		order[i], length[i], prev[i] = slices.Index(old, x), 1, -1
		for j := range i {
			if order[j] < order[i] && length[j]+1 > length[i] {
				length[i], prev[i] = length[j]+1, j
			}
		}
		if best < 0 || length[i] > length[best] {
			best = i
		}
	}
	kept := map[T]bool{}
	for i := best; i >= 0; i = prev[i] {
		kept[now[i]] = true
	}
	return kept
}

// The element of list nearest to index k, in the direction step, that keeps its place.
func nearest[T comparable](list []T, k, step int, kept map[T]bool) (T, bool) {
	for i := k + step; i >= 0 && i < len(list); i += step {
		if kept[list[i]] {
			return list[i], true
		}
	}
	var zero T
	return zero, false
}

type spliceWriter struct {
	tree    *syntaxTree
	lines   *lineMap
	model   *rotationModel
	out     *lineEdits
	printer *printer
}

func newSpliceWriter(d *Doc, m *rotationModel) *spliceWriter {
	f := d.typed
	return &spliceWriter{
		tree:    f.tree,
		lines:   f.tree.lines,
		model:   m,
		out:     newLineEdits(d.src, f.tree),
		printer: &printer{ix: d.ix, names: d.names, class: f.typer.class, declarations: declaredBy(m.json()).variables},
	}
}

func groupScope(g *spliceGroup) scope {
	if g == nil {
		return scope{}
	}
	return scope{group: g.name, inGroup: true}
}

// The slots the edits leave as they are whose statements are in canonical form with the variables the rotation
// declares before the edits, before, and not with those it declares after them: how a variable reference is written
// depends on the others (SPEC.md §12.3).
func (w *spliceWriter) unsettled(before []declared) []*spliceSlot {
	p := *w.printer
	p.declarations = before
	var out []*spliceSlot
	for _, list := range w.model.lists() {
		was := scope{}
		if g := list.group; g != nil && g.header != nil {
			was = scope{group: g.header.group.value, inGroup: true}
		}
		for _, s := range list.slots {
			if s.dirty || s.unit.header != nil {
				continue
			}
			written := w.out.written(s.unit.first, s.unit.last)
			same := func(lines []spliceLine) bool {
				return slices.EqualFunc(lines, written, func(a, b spliceLine) bool { return a.text == b.text })
			}
			if same(w.render(s, list, &p, was)) && !same(w.render(s, list, w.printer, groupScope(list.group))) {
				out = append(out, s)
			}
		}
	}
	return out
}

// The text's changes.
func (w *spliceWriter) statements() *lineEdits {
	for _, list := range w.model.own {
		w.list(list)
	}
	w.groups()
	return w.out
}

func (w *spliceWriter) list(list *spliceList) {
	out := w.out
	old, slots := list.old, list.slots
	var block *lineBlock
	if list.group != nil {
		block = list.group.block
	}
	// A statement written on its section's header line stays there while it stays first and as written, and its group
	// keeps its name; otherwise it goes on a line of its own.
	var onHeader *headerStmt
	if len(old) > 0 {
		onHeader = old[0].unit.header
	}
	split := onHeader != nil && (len(slots) == 0 || slots[0] != old[0] || old[0].dirty || list.group != nil && list.group.renamed)
	if split {
		line := w.lines.line(onHeader.start)
		out.drop(line, w.lines.line(onHeader.end))
		text := onHeader.name.text + ":"
		if list.group != nil {
			text = sectionGroup + " " + jsonString(list.group.name) + ":"
		}
		out.insert(line, []spliceLine{headerLine(text)}, block)
		old[0].dirty = true // It is printed from its JSON on its own line.
	}
	lined := func(s *spliceSlot) bool { return s.unit != nil && !(split && s.unit.header != nil) }
	for _, s := range old {
		if lined(s) && !slices.Contains(slots, s) {
			out.drop(s.unit.first, s.unit.last)
		}
	}
	anchors := stable(slices.DeleteFunc(slices.Clone(slots), func(s *spliceSlot) bool { return !lined(s) }), old)
	home, hasHome := w.home(list)
	var fresh []spliceLine
	for k, s := range slots {
		if anchors[s] && !s.dirty {
			continue
		}
		var lines []spliceLine
		if lined(s) && !s.dirty {
			lines = out.written(s.unit.first, s.unit.last)
		} else {
			lines = w.render(s, list, w.printer, groupScope(list.group))
		}
		if lined(s) {
			out.drop(s.unit.first, s.unit.last)
		}
		prev, hasPrev := nearest(slots, k, -1, anchors)
		next, hasNext := nearest(slots, k, 1, anchors)
		switch {
		case anchors[s]:
			out.insert(s.unit.first, lines, block)
		case hasPrev:
			out.insert(prev.unit.last+1, lines, block)
		case hasNext:
			out.insert(next.unit.first, lines, block)
		case hasHome:
			out.insert(home, lines, block)
		default:
			fresh = append(fresh, lines...)
		}
	}
	if len(fresh) > 0 {
		at, top := w.newSection(list)
		out.insert(at, append(top, fresh...), nil)
	}
}

// Where a list's elements go when none of its statements keeps its place: where its first one was, or after its
// section's header or last statement. False when the text holds no place for them.
func (w *spliceWriter) home(list *spliceList) (int, bool) {
	for _, s := range list.old {
		if s.unit.header == nil {
			return s.unit.first, true
		}
	}
	if g := list.group; g != nil && g.header != nil {
		if list.row {
			return g.block.last + 1, true
		}
		return w.lines.line(g.header.end) + 1, true
	}
	if s := list.section; s != nil && (s.header != nil || len(s.body) > 0) {
		return lastLine(s, w.lines) + 1, true
	}
	return 0, false
}

// A section the text does not hold, after the sections that come before it (SPEC.md §12.1): its place, and the lines
// in front of its statements. The value variables of an x.apl.siml are lines at the top level.
func (w *spliceWriter) newSection(list *spliceList) (int, []spliceLine) {
	switch {
	case !list.row:
		return w.after(), []spliceLine{blankSpliceLine}
	case list.prepull:
		return w.after(), []spliceLine{blankSpliceLine, headerLine(sectionPrepull + ":")}
	}
	return w.after(sectionPrepull), []spliceLine{blankSpliceLine, headerLine(sectionPriority + ":")}
}

// The line after the top-level statements, the section no header names, and the sections named names.
func (w *spliceWriter) after(names ...string) int {
	last := -1
	for _, s := range w.tree.top {
		last = max(last, w.lines.line(s.base().end))
	}
	for i, s := range w.tree.sections {
		if i == 0 || slices.Contains(names, s.name) {
			last = max(last, lastLine(s, w.lines))
		}
	}
	return last + 1
}

func (w *spliceWriter) groups() {
	out, m := w.out, w.model
	for _, g := range m.old {
		if !slices.Contains(m.groups, g) {
			out.drop(g.block.first, g.block.last)
		}
	}
	for _, g := range m.groups {
		if g.header == nil {
			continue
		}
		if g.renamed && g.header.body == nil {
			text := sectionGroup + " " + jsonString(g.name) + ":"
			if k := slices.IndexFunc(g.header.inner, func(t trivia) bool { return t.kind == triviaComment }); k >= 0 {
				text += " " + trailingText(g.header.inner[k])
			}
			line := w.lines.line(g.header.start)
			out.drop(line, line)
			out.insert(line, []spliceLine{headerLine(text)}, g.block)
		}
		w.list(g.variables)
		w.list(g.actions)
	}
	anchors := stable(slices.DeleteFunc(slices.Clone(m.groups), func(g *spliceGroup) bool { return g.block == nil }), m.old)
	for k, g := range m.groups {
		if anchors[g] {
			continue
		}
		var lines []spliceLine
		if g.block != nil {
			lines = out.moveOut(g.block)
		} else {
			lines = w.group(g)
		}
		if prev, ok := nearest(m.groups, k, -1, anchors); ok {
			out.insert(prev.block.last+1, slices.Concat([]spliceLine{blankSpliceLine}, lines), nil)
		} else if next, ok := nearest(m.groups, k, 1, anchors); ok {
			out.insert(next.block.first, append(lines, blankSpliceLine), nil)
		} else {
			out.insert(w.after(sectionPrepull, sectionPriority), slices.Concat([]spliceLine{blankSpliceLine}, lines), nil)
		}
	}
}

// A group the text does not hold.
func (w *spliceWriter) group(g *spliceGroup) []spliceLine {
	lines := []spliceLine{headerLine(sectionGroup + " " + jsonString(g.name) + ":")}
	for _, list := range []*spliceList{g.variables, g.actions} {
		for _, s := range list.slots {
			lines = append(lines, w.render(s, list, w.printer, groupScope(g))...)
		}
	}
	return lines
}

// A slot printed from its JSON, with the comment lines directly above its statement, and the comments in it: one at
// the end of its last line stays there, and any other goes above it.
func (w *spliceWriter) render(s *spliceSlot, list *spliceList, p *printer, sc scope) []spliceLine {
	u := s.unit
	indent := list.indent
	if u != nil && u.header == nil {
		indent = columnOf(u.statement, w.lines)
	}
	var ps *printedStmt
	if list.row {
		ps = p.row(s.msg, list.prepull, sc, indent)
	} else {
		ps = p.variable(s.msg, sc, indent)
	}
	if s.raw {
		ps = ps.expect.fallback()
	}
	var above []string
	if u != nil {
		for _, c := range u.comments {
			above = append(above, w.out.line(c.line))
		}
		host := u.statement.base()
		if u.header != nil {
			host = u.header.base()
		}
		inner := slices.DeleteFunc(slices.Clone(host.inner), func(t trivia) bool { return t.kind != triviaComment })
		if len(inner) == 1 && inner[0].line == w.lines.line(host.end) {
			ps.trailing = trailingText(inner[0])
		} else {
			for _, c := range inner {
				above = append(above, commentLine(c, indent).line)
			}
		}
	}
	var out []spliceLine
	for _, t := range append(above, statementLines(ps)...) {
		out = append(out, spliceLine{text: t, from: -1})
	}
	return out
}
