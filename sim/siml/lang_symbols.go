package siml

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// The names a rotation gives its own parts, which go to definition, find references and rename work on: value and
// group variables, groups, sequences and placeholders; and the outline, folding and links of a file.

// An occurrence as the analysis reads it, at byte offsets of the file it is found in.
type occurrence struct {
	kind       string // variable, group, sequence or placeholder.
	name       string // The exact name it means; the written name when it resolves to nothing.
	span              // `$x`, `${X}`, `"Name"` or `%p`.
	definition bool
	scope      scope  // The group a variable or placeholder belongs to.
	resolved   bool   // Whether this file, or the file a use … with bind sets a variable of, declares what it names.
	file       string // For a use … with bind: the file that declares the variable it sets.
}

// Visits every node under n, parents before children in the order the text writes them, with the node that holds it.
func walkTree(n any, parent any, visit func(n, parent any)) {
	if n == nil {
		return
	}
	switch x := n.(type) {
	case node:
		if isNilNode(x) {
			return
		}
	case stmt:
	case *arg, *flag, *varBind, *placeholderBind:
	default:
		return
	}
	visit(n, parent)
	each := func(children ...any) {
		for _, c := range children {
			walkTree(c, n, visit)
		}
	}
	switch x := n.(type) {
	case *headerStmt:
		if x.group != nil {
			each(x.group)
		}
		if x.body != nil {
			each(x.body)
		}
	case *useStmt:
		each(&x.path)
		for i := range x.with {
			each(&x.with[i])
		}
	case *varBind:
		each(x.variable, x.value)
	case *varStmt:
		each(x.variable, x.value)
	case *rowStmt:
		each(x.doAt)
		if x.action != nil {
			each(x.action)
		}
	case *slotRowStmt:
		if x.raw != nil {
			each(x.raw)
		}
	case *flagListStmt:
		for i := range x.flags {
			each(&x.flags[i])
		}
	case *flag:
		each(x.value)
	case *fieldEntryStmt:
		for _, v := range x.values {
			each(v)
		}
	case *messageEntryStmt:
		each(x.args)
	case *rawEntryStmt:
		each(x.value)
	case *parenNode:
		each(x.expr)
	case *notNode:
		each(x.operand)
	case *logicNode:
		for _, o := range x.operands {
			each(o)
		}
	case *compareNode:
		each(x.left, x.right)
	case *mathNode:
		each(x.left, x.right)
	case *callNode:
		if x.args != nil {
			each(x.args)
		}
	case *accessorNode:
		each(x.subject)
		if x.args != nil {
			each(x.args)
		}
	case *argList:
		for i := range x.items {
			each(&x.items[i])
		}
	case *arg:
		each(x.value)
	case *listNode:
		for _, item := range x.items {
			each(item)
		}
	case *actionNode:
		each(x.step, x.condition)
	case *castStep:
		each(x.spell, x.target)
	case *channelStep:
		each(x.spell, x.target, x.until)
	case *waitStep:
		each(x.value)
	case *moveStep:
		each(x.value)
	case *groupStep:
		each(x.name)
		for i := range x.with {
			each(&x.with[i])
		}
	case *placeholderBind:
		each(x.placeholder, x.value)
	case *scheduleStep:
		each(x.schedule, x.step)
	case *sequenceStep:
		each(x.name)
		for _, a := range x.actions {
			each(a)
		}
	}
}

// Whether a node interface holds a nil pointer.
func isNilNode(n node) bool {
	switch x := n.(type) {
	case *actionNode:
		return x == nil
	case *argList:
		return x == nil
	case *stringNode:
		return x == nil
	case *rawNode:
		return x == nil
	case *varNode:
		return x == nil
	case *placeholderNode:
		return x == nil
	}
	return false
}

// Every occurrence of a variable, group, sequence or placeholder in the file, in file order.
func (d *Doc) occurrences() []occurrence {
	tree := d.tree()
	if tree == nil {
		return nil
	}
	ix := d.ix
	sections := sectionsByStatement(tree)
	var out []occurrence
	type declaration struct {
		name  string
		scope scope
		node  *varNode
	}
	type use struct {
		node  *varNode
		scope scope
	}
	var declarations []declaration
	var uses []use
	for _, statement := range tree.statements {
		sc := scopeOf(sections[statement])
		if u, ok := statement.(*useStmt); ok {
			out = append(out, d.withBinds(u)...)
			continue
		}
		if h, ok := statement.(*headerStmt); ok && h.group != nil && sections[statement] != nil && sections[statement].name == sectionGroup {
			out = append(out, occurrence{kind: "group", name: h.group.value, span: h.group.span, definition: true, resolved: true})
		}
		walkTree(statement, nil, func(n, parent any) {
			switch x := n.(type) {
			case *varNode:
				if v, ok := statement.(*varStmt); ok && v.variable == x {
					declarations = append(declarations, declaration{name: x.name, scope: sc, node: x})
				} else {
					uses = append(uses, use{node: x, scope: sc})
				}
			case *placeholderNode:
				// A with list's placeholders belong to the group it references, and are added with that reference.
				if _, bind := parent.(*placeholderBind); !bind {
					out = append(out, occurrence{kind: "placeholder", name: x.name, span: x.span, definition: true, scope: sc, resolved: true})
				}
			case *groupStep:
				out = append(out, occurrence{kind: "group", name: x.name.value, span: x.name.span, resolved: true})
				for _, b := range x.with {
					out = append(out, occurrence{
						kind: "placeholder", name: b.placeholder.name, span: b.placeholder.span,
						scope: scope{group: x.name.value, inGroup: true}, resolved: true,
					})
				}
			case *sequenceStep:
				out = append(out, occurrence{kind: "sequence", name: x.name.value, span: x.name.span, definition: true, resolved: true})
			case *accessorNode:
				if s, ok := x.subject.(*stringNode); ok && x.head.text == "sequence" {
					out = append(out, occurrence{kind: "sequence", name: s.value, span: s.span, resolved: true})
				}
			case *callNode:
				kind := ix.actionKinds[x.name.text]
				if kind == nil {
					kind = ix.valueKinds[x.name.text]
				}
				if kind == nil || x.args == nil {
					break
				}
				for _, a := range x.args.items {
					fieldName := kind.Positional
					if a.name != nil {
						fieldName = ""
						if f := kind.message.byName[a.name.text]; f != nil {
							fieldName = f.Name
						}
					}
					if s, ok := a.value.(*stringNode); ok {
						if named := ix.namedBy(kind, fieldName); named != "" {
							out = append(out, occurrence{kind: named, name: s.value, span: s.span, resolved: true})
						}
					}
				}
			}
		})
	}
	seen := make([]declared, len(declarations))
	for i, x := range declarations {
		seen[i] = declared{name: x.name, scope: x.scope}
		out = append(out, occurrence{kind: "variable", name: x.name, span: x.node.span, definition: true, scope: x.scope, resolved: true})
	}
	for _, u := range uses {
		res := resolveVariable(u.node.name, u.node.braced, declaredIn(seen, u.scope))
		name := u.node.name
		if res.found {
			name = res.name
		}
		o := occurrence{kind: "variable", name: name, span: u.node.span, resolved: res.found}
		for _, x := range declarations {
			if x.name == name && (!x.scope.inGroup || x.scope == u.scope) {
				o.scope = x.scope
				break
			}
		}
		out = append(out, o)
	}
	// Groups and sequences the file names but never defines resolve to nothing.
	defined := map[string]bool{}
	for _, o := range out {
		if o.definition {
			defined[o.kind+"\x00"+o.name] = true
		}
	}
	for i, o := range out {
		if (o.kind == "group" || o.kind == "sequence") && !defined[o.kind+"\x00"+o.name] {
			out[i].resolved = false
		}
	}
	slices.SortStableFunc(out, func(a, b occurrence) int { return a.start - b.start })
	return out
}

// The variables a use … with list sets, each an occurrence of the variable in the file that declares it: the used file,
// or one it uses in turn. They resolve as the parser reads them, against every variable those files declare.
func (d *Doc) withBinds(u *useStmt) []occurrence {
	path := resolveUse(d.path, u.path.value)
	var found []declaredVariable
	if len(u.with) > 0 {
		found = d.declaredThrough(path, []string{d.path})
	}
	names := make([]string, len(found))
	for i, x := range found {
		names[i] = x.name
	}
	out := make([]occurrence, len(u.with))
	for i, b := range u.with {
		res := resolveVariable(b.variable.name, b.variable.braced, names)
		name := b.variable.name
		if res.found {
			name = res.name
		}
		file := path
		for _, x := range found {
			if x.name == name {
				file = x.file
				break
			}
		}
		out[i] = occurrence{kind: "variable", name: name, span: b.variable.span, resolved: res.found, file: file}
	}
	return out
}

// A variable a used file declares outside its groups, with that file.
type declaredVariable struct{ name, file string }

// The variables a use line naming usePath can set: those the file declares outside its groups, then those of the files
// it uses in turn, each with the file that declares it.
func (d *Doc) settableVariables(usePath string) []declaredVariable {
	return d.declaredThrough(resolveUse(d.path, usePath), []string{d.path})
}

func (d *Doc) declaredThrough(path string, chain []string) []declaredVariable {
	if slices.ContainsFunc(chain, func(file string) bool { return samePath(file, path) }) {
		return nil
	}
	text, ok := d.readUsed(path)
	if !ok {
		return nil
	}
	used := d.analyze(path, text)
	tree := used.tree()
	if tree == nil {
		return nil
	}
	sections := sectionsByStatement(tree)
	var out []declaredVariable
	for _, s := range tree.statements {
		switch x := s.(type) {
		case *varStmt:
			if sections[s] == nil || sections[s].group == nil {
				out = append(out, declaredVariable{name: x.variable.name, file: path})
			}
		case *useStmt:
			out = append(out, used.declaredThrough(resolveUse(path, x.path.value), append(slices.Clone(chain), path))...)
		}
	}
	return out
}

// Whether two occurrences name the same thing; file is the path a local occurrence's file has.
func sameOccurrence(a occurrence, aFile string, b occurrence, bFile string) bool {
	if a.file != "" {
		aFile = a.file
	}
	if b.file != "" {
		bFile = b.file
	}
	if a.kind != b.kind || a.name != b.name || !samePath(aFile, bFile) {
		return false
	}
	return a.kind == "group" || a.kind == "sequence" || a.scope == b.scope
}

func (d *Doc) publicOccurrence(o occurrence) Occurrence {
	path := d.path
	if o.file != "" {
		path = o.file
	}
	return Occurrence{
		Kind: o.kind, Name: o.name, Range: d.rangeOf(o.span), Declaration: o.definition, Path: path,
		Group: o.scope.group, InGroup: o.scope.inGroup, Resolved: o.resolved,
	}
}

func (d *Doc) occurrenceAt(offset int) (occurrence, bool) {
	for _, o := range d.occurrences() {
		if o.holds(offset) {
			return o, true
		}
	}
	return occurrence{}, false
}

// The file that declares what an occurrence names, read as use reads it, with the occurrence as it is found there:
// this file, or for a use … with bind the file that declares the variable.
func (d *Doc) homeOf(at occurrence) (*Doc, occurrence, bool) {
	if at.file == "" {
		return d, at, true
	}
	text, ok := d.readUsed(at.file)
	if !ok {
		return nil, occurrence{}, false
	}
	key := at
	key.file = ""
	return d.analyze(at.file, text), key, true
}

// The first declaration of what an occurrence names, with the file it is in.
func (d *Doc) declarationOf(at occurrence) (*Doc, occurrence, bool) {
	home, key, ok := d.homeOf(at)
	if !ok {
		return nil, occurrence{}, false
	}
	for _, o := range home.occurrences() {
		if o.definition && sameOccurrence(o, home.path, key, home.path) {
			return home, o, true
		}
	}
	return nil, occurrence{}, false
}

// A place in a file.
type Location struct {
	Path  string
	Range Range
}

// An occurrence where it is found.
type foundOccurrence struct {
	doc *Doc
	o   occurrence
}

func (f foundOccurrence) location() Location {
	return Location{Path: f.doc.path, Range: f.doc.rangeOf(f.o.span)}
}

// Every occurrence of what key names in home, and, for a variable outside the groups of a saved file, the use … with
// binds that set it in the .siml files near home and in from.
func everywhere(home *Doc, key occurrence, from *Doc) []foundOccurrence {
	var out []foundOccurrence
	for _, o := range home.occurrences() {
		if sameOccurrence(o, home.path, key, home.path) {
			out = append(out, foundOccurrence{home, o})
		}
	}
	if key.kind != "variable" || key.scope.inGroup || home.path == "" {
		return out
	}
	files := nearbyFiles(home.path)
	if from != home && !slices.ContainsFunc(files, func(file string) bool { return samePath(file, from.path) }) {
		files = append(files, from.path)
	}
	for _, file := range files {
		own := samePath(file, from.path)
		other := from
		if !own {
			text, ok := home.readUsed(file)
			if !ok || !useWith.MatchString(text) || !withWord.MatchString(text) {
				continue
			}
			other = home.analyze(file, text)
		} else if !useWith.MatchString(from.src) || !withWord.MatchString(from.src) {
			continue
		}
		for _, o := range other.occurrences() {
			if o.file != "" && samePath(o.file, home.path) && o.name == key.name {
				out = append(out, foundOccurrence{other, o})
			}
		}
	}
	return out
}

var (
	useWith  = regexp.MustCompile(`\buse\b`)
	withWord = regexp.MustCompile(`\bwith\b`)
)

// The .siml files near a file, which use names by a short path from its folder: those in its folder and the folder
// above, and in the folders those hold (../gear_sets/p1.gear.siml from an apls folder). The file itself is left out.
func nearbyFiles(path string) []string {
	folder := filepath.Dir(path)
	var files []string
	add := func(file string) {
		if !slices.Contains(files, file) && !samePath(file, path) {
			files = append(files, file)
		}
	}
	for _, dir := range []string{folder, filepath.Dir(folder)} {
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			full := filepath.Join(dir, e.Name())
			if strings.HasSuffix(e.Name(), ".siml") {
				add(full)
			} else if e.IsDir() {
				inner, _ := os.ReadDir(full)
				for _, x := range inner {
					if strings.HasSuffix(x.Name(), ".siml") {
						add(filepath.Join(full, x.Name()))
					}
				}
			}
		}
	}
	return files
}

// The files the use lines name that exist, each with its path's string.
func (d *Doc) linkedFiles() []Link {
	tree := d.tree()
	if tree == nil || d.path == "" {
		return nil
	}
	var out []Link
	for _, s := range tree.top {
		u, ok := s.(*useStmt)
		if !ok {
			continue
		}
		path := filepath.FromSlash(resolveUse(d.path, u.path.value))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			out = append(out, Link{Range: d.rangeOf(u.path.span), Path: path})
		}
	}
	return out
}

// What the occurrence at a position names, where it is declared; or the file a use path there names, at its start.
func (d *Doc) Definition(at Position) []Location {
	offset := d.Offset(at)
	for _, l := range d.linkedFiles() {
		if r := l.Range; d.Offset(r.Start) <= offset && offset <= d.Offset(r.End) {
			start := Position{Line: 1, Col: 1}
			return []Location{{Path: l.Path, Range: Range{start, start}}}
		}
	}
	o, ok := d.occurrenceAt(offset)
	if !ok {
		return nil
	}
	home, key, ok := d.homeOf(o)
	if !ok {
		return nil
	}
	var out []Location
	for _, x := range home.occurrences() {
		if x.definition && sameOccurrence(x, home.path, key, home.path) {
			out = append(out, foundOccurrence{home, x}.location())
		}
	}
	return out
}

// Every occurrence of what the occurrence at a position names, in this file, the file that declares it and the files
// near that one whose use … with lists set it.
func (d *Doc) References(at Position, includeDeclaration bool) []Location {
	o, ok := d.occurrenceAt(d.Offset(at))
	if !ok {
		return nil
	}
	home, key, ok := d.homeOf(o)
	if !ok {
		return nil
	}
	var out []Location
	for _, f := range everywhere(home, key, d) {
		if includeDeclaration || !f.o.definition {
			out = append(out, f.location())
		}
	}
	return out
}

// The occurrence a rename starts from, with its name, or why there is none.
func (d *Doc) PrepareRename(at Position) (Range, string, error) {
	o, ok := d.occurrenceAt(d.Offset(at))
	if !ok {
		return Range{}, "", fmt.Errorf("Only variables, groups, sequences and placeholders rename.")
	}
	if !o.resolved {
		file := "This file"
		if o.file != "" {
			file = filepath.Base(o.file)
		}
		return Range{}, "", fmt.Errorf("%s does not declare %s, so it cannot rename it.", file, o.name)
	}
	return d.rangeOf(o.span), o.name, nil
}

// How an occurrence of a renamed symbol is written.
func spelled(kind, name string) string {
	switch kind {
	case "variable":
		return variableRef(name)
	case "placeholder":
		return placeholderRef(name)
	}
	text, _ := json.Marshal(name)
	return string(text)
}

// Whether name can be written as a name of kind (variable, placeholder, group or sequence): it is not empty, and a
// variable's or placeholder's holds no } or line break, which no spelling of one writes.
func IsIdentifierFor(kind, name string) bool { return identifierRefusal(kind, name) == "" }

func identifierRefusal(kind, name string) string {
	if name == "" {
		return "A name cannot be empty."
	}
	if (kind == "variable" || kind == "placeholder") && strings.ContainsAny(name, "}\r\n") {
		return fmt.Sprintf("A %s's name cannot hold } or a line break.", kind)
	}
	return ""
}

// Why what key names in d cannot take newName: it cannot be written, or another of its kind, seen where it is, has the
// name, which would merge the two. Variables compare by identifier, which a $name reference also resolves by.
func (d *Doc) renameRefusal(key occurrence, newName string) string {
	if why := identifierRefusal(key.kind, newName); why != "" {
		return why
	}
	seen := func(o occurrence) bool {
		return key.kind == "group" || key.kind == "sequence" || o.scope == key.scope ||
			key.kind == "variable" && (!o.scope.inGroup || !key.scope.inGroup)
	}
	taken := func(o occurrence) bool {
		if key.kind == "variable" {
			return Identifier(o.name) == Identifier(newName)
		}
		return o.name == newName
	}
	for _, o := range d.occurrences() {
		if o.definition && o.kind == key.kind && !sameOccurrence(o, d.path, key, d.path) && seen(o) && taken(o) {
			file := filepath.Base(d.path)
			if d.path == "" {
				file = "The file"
			}
			return fmt.Sprintf("%s has a %s named %s already.", file, key.kind, o.name)
		}
	}
	return ""
}

// A file's edits.
type FileEdits struct {
	Path  string
	Edits []TextEdit
}

// The edits that rename what the occurrence at a position names, in every file that names it, the files in the order
// they are first found; or why it cannot be. Nothing and no error when nothing there renames.
func (d *Doc) Rename(at Position, newName string) ([]FileEdits, error) {
	o, ok := d.occurrenceAt(d.Offset(at))
	if !ok || !o.resolved {
		return nil, nil
	}
	home, key, ok := d.homeOf(o)
	if !ok {
		return nil, nil
	}
	if why := home.renameRefusal(key, newName); why != "" {
		return nil, fmt.Errorf("%s", why)
	}
	var out []FileEdits
	for _, f := range everywhere(home, key, d) {
		i := slices.IndexFunc(out, func(e FileEdits) bool { return samePath(e.Path, f.doc.path) })
		if i < 0 {
			out = append(out, FileEdits{Path: f.doc.path})
			i = len(out) - 1
		}
		out[i].Edits = append(out[i].Edits, TextEdit{Range: f.doc.rangeOf(f.o.span), NewText: spelled(f.o.kind, newName)})
	}
	return out, nil
}

// Groups, sequences, variables and placeholders: each declaration and use, in file order.
func (d *Doc) occurrencesPublic() []Occurrence {
	var out []Occurrence
	for _, o := range d.occurrences() {
		out = append(out, d.publicOccurrence(o))
	}
	return out
}

// The sections and the group's and file's variables, for the outline.
func (d *Doc) symbols() []Symbol {
	tree := d.tree()
	if tree == nil {
		return nil
	}
	all := d.occurrences()
	symbol := func(name, detail string, kind SymbolKind, r, selection span) Symbol {
		return Symbol{Name: name, Detail: detail, Kind: kind, Range: d.rangeOf(r), Selection: d.rangeOf(selection)}
	}
	variables := func(inside *span, sc scope) []Symbol {
		var out []Symbol
		for _, o := range all {
			if o.kind == "variable" && o.definition && o.scope == sc && (inside == nil || inside.holds(o.start)) {
				out = append(out, symbol(o.name, "variable", SymbolVariable, o.span, o.span))
			}
		}
		return out
	}
	firstHeader := len(d.src) + 1
	for _, s := range tree.sections {
		if s.header != nil {
			firstHeader = sectionSpan(s).start
			break
		}
	}
	var out []Symbol
	for _, v := range variables(nil, scope{}) {
		if d.Offset(v.Range.Start) < firstHeader {
			out = append(out, v)
		}
	}
	for _, s := range tree.sections {
		if s.header == nil {
			continue
		}
		at := sectionSpan(s)
		name, kind := s.name, SymbolNamespace
		if s.group != nil {
			text, _ := json.Marshal(s.group.value)
			name, kind = "group "+string(text), SymbolModule
		}
		var children []Symbol
		if s.group != nil || s.name == sectionAPL {
			children = variables(&at, scopeOf(s))
		}
		for _, o := range all {
			if o.kind == "sequence" && o.definition && at.holds(o.start) {
				children = append(children, symbol(o.name, "sequence", SymbolEvent, o.span, o.span))
			}
		}
		sym := symbol(name, "", kind, at, s.header.span)
		sym.Children = children
		out = append(out, sym)
	}
	return out
}

// A folding range: its first and last lines, 1-based, and what it folds (region, imports, comment or "").
type Fold struct {
	StartLine, EndLine int
	Kind               string
}

// Each section, each statement that runs over several lines, the block of use lines and each run of comment lines.
func (d *Doc) folds() []Fold {
	tree := d.tree()
	if tree == nil {
		return nil
	}
	var out []Fold
	line := func(offset int) int { return d.lines.line(offset) + 1 }
	fold := func(start, end int, kind string) {
		if end > start {
			out = append(out, Fold{StartLine: start, EndLine: end, Kind: kind})
		}
	}
	for _, s := range tree.sections {
		if s.header != nil {
			at := sectionSpan(s)
			fold(line(at.start), line(at.end), "region")
		}
	}
	for _, s := range tree.statements {
		b := s.base()
		fold(line(b.start), line(b.end), "")
	}
	var uses []stmt
	for _, s := range tree.top {
		if _, ok := s.(*useStmt); ok {
			uses = append(uses, s)
		}
	}
	if len(uses) > 1 {
		fold(line(uses[0].base().start), line(uses[len(uses)-1].base().end), "imports")
	}
	var comments []int
	for _, s := range tree.statements {
		for _, t := range s.base().leading {
			if t.kind == triviaComment {
				comments = append(comments, t.line+1)
			}
		}
	}
	for _, t := range tree.trailing {
		if t.kind == triviaComment {
			comments = append(comments, t.line+1)
		}
	}
	var run []int
	flush := func() {
		if len(run) > 1 {
			fold(run[0], run[len(run)-1], "comment")
		}
		run = nil
	}
	for _, l := range comments {
		if len(run) > 0 && l != run[len(run)-1]+1 {
			flush()
		}
		run = append(run, l)
	}
	flush()
	return out
}

// How a reference to a variable is written: `$name`, or `${Name}` when the name is no ident.
func variableRef(name string) string {
	if identPattern.MatchString(name) {
		return "$" + name
	}
	return braced("$", name)
}

// How a placeholder is written: `%name`, or `%{Name}` when the name is no ident.
func placeholderRef(name string) string {
	if identPattern.MatchString(name) {
		return "%" + name
	}
	return braced("%", name)
}
