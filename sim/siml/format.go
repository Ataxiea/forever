package siml

import (
	"strings"
	"unicode"

	"google.golang.org/protobuf/reflect/protoreflect"
)

// format (SPEC.md §12.1, §10): every statement of a file re-printed from its typed value, with the comments, notes
// and single blank lines of the source kept. A file with errors is not formatted, and use lines are not followed:
// format reads one file.

// Re-prints src, the text of the file at path, in canonical form, its names read and written with names. The error
// is Diagnostics when the file has an error.
func Format(path string, src []byte, names *Names) ([]byte, error) {
	ix, err := loadIndex()
	if err != nil {
		return nil, err
	}
	f := readFile(ix, names, sourceText(src), kindOf(path), nil)
	if hasError(f.diags) {
		return nil, f.tree.lines.diagnostics(path, f.diags)
	}
	return []byte(f.format()), nil
}

// The block a statement belongs to: the top-level lines, the statements under no header, or a section.
type block struct {
	top     bool
	section *section
}

func (f *typedFile) format() string {
	ix := f.typer.ix
	tree := f.tree
	p := &printer{ix: ix, names: f.typer.names, class: f.typer.class, declarations: declaredNames(f.declarations)}
	sectionOf := map[stmt]*section{}
	for _, s := range tree.sections {
		if s.header != nil {
			sectionOf[s.header] = s
		}
		for _, b := range s.body {
			sectionOf[b] = s
		}
	}
	var implied *section
	if f.kind.Section != "" {
		implied = tree.sections[0]
	}
	var items []*item

	// The comment and blank lines above a statement, a run of blank lines as one: none before the file's first line
	// or a section's first body line, and exactly one before the first line of a block.
	leading := func(triv []trivia, indent int, startsBlock, startsSection bool) {
		var lines []*trivia // A nil line is a blank one.
		for i := range triv {
			switch t := &triv[i]; {
			case t.kind == triviaComment:
				lines = append(lines, t)
			case t.kind == triviaBlank && (len(lines) == 0 || lines[len(lines)-1] != nil):
				lines = append(lines, nil)
			}
		}
		blankFirst := len(lines) > 0 && lines[0] == nil
		if blankFirst {
			lines = lines[1:]
		}
		if startsBlock || blankFirst && !startsSection && len(items) > 0 {
			items = append(items, blankLine())
		}
		for _, l := range lines {
			if l == nil {
				items = append(items, blankLine())
			} else {
				items = append(items, commentLine(*l, indent))
			}
		}
	}

	var current block
	var previous stmt
	carried := "" // A header's trailing comment, which goes to the body line written after it.
	var header *item
	for _, s := range tree.inFileOrder() {
		section := sectionOf[s]
		group := block{section: section}
		switch s.(type) {
		case *versionStmt, *specStmt, *talentsStmt, *useStmt:
			group = block{top: true}
		}
		_, isHeader := s.(*headerStmt)
		indent := 0
		if section != nil && !isHeader && section != implied {
			indent = indentWidth
		}
		startsBlock := previous != nil && group != current
		prev, afterHeader := previous.(*headerStmt)
		startsSection := afterHeader && sectionOf[previous] == section
		var onHeader *item
		if afterHeader && prev.body == s {
			onHeader = header
		}
		current, previous = group, s
		b := s.base()
		leading(b.leading, indent, startsBlock, startsSection)
		// One comment on a statement's last line stays at the end of its last line; any other inner comment is
		// written above it.
		var comments []trivia
		for _, t := range b.inner {
			if t.kind == triviaComment {
				comments = append(comments, t)
			}
		}
		onLastLine := len(comments) == 1 && comments[0].line == tree.lines.line(b.end)
		if !onLastLine {
			for _, c := range comments {
				items = append(items, commentLine(c, indent))
			}
		}
		trailing := carried
		if onLastLine {
			trailing = trailingText(comments[0])
		}
		carried = ""
		if isHeader && s.(*headerStmt).body != nil {
			carried, trailing = trailing, ""
		}
		line := func(text string) *item {
			if trailing != "" {
				text += " " + trailing
			}
			return &item{line: text}
		}
		add := func(st *printedStmt) {
			st.trailing = trailing
			items = append(items, &item{stmt: st})
		}
		sc := scope{}
		if section != nil && section.group != nil {
			sc = scope{group: section.group.value, inGroup: true}
		}
		switch s := s.(type) {
		case *versionStmt:
			items = append(items, line("siml 1"))
		case *specStmt:
			items = append(items, line("spec "+s.spec.text))
		case *talentsStmt:
			items = append(items, line("talents "+jsonString(s.talents.value)))
		case *useStmt:
			binds := make([]useBind, len(s.with))
			for i, w := range s.with {
				binds[i] = useBind{name: w.variable.name, braced: w.variable.braced, value: f.withs[s][i]}
			}
			add(p.use(s.path.value, binds, indent))
		case *headerStmt:
			text := s.name.text + ":"
			if s.group != nil {
				text = "group " + jsonString(s.group.value) + ":"
			}
			header = line(text)
			items = append(items, header)
		case *varStmt:
			add(p.variable(f.written[s], sc, indent))
		case *rowStmt:
			add(p.row(f.written[s], section.name == sectionPrepull, sc, indent))
		case *slotRowStmt:
			w := f.entries[s][0]
			slot := ix.enums[slotEnum].byNumber[int32(w.index)].Short
			enchant := ""
			if s.enchant != nil {
				enchant = s.enchant.text
			}
			add(p.slotRow(slot, w.value.Message(), w.placed, w.index, indent, enchant))
		default:
			if !isEntry(s) || section == nil {
				break
			}
			stmts := p.entries(statementWrites(f.entries[s]), indent)
			if len(stmts) > 0 {
				stmts[len(stmts)-1].trailing = trailing
			}
			// A section's one entry stays on its header line when it is written there.
			if onHeader != nil && len(stmts) == 1 && len(section.body) == 1 {
				onHeader.join = true
			}
			for _, st := range stmts {
				items = append(items, &item{stmt: st})
			}
		}
	}
	blank := false
	for _, t := range tree.trailing {
		switch t.kind {
		case triviaBlank:
			blank = true
		case triviaComment:
			if blank {
				items = append(items, blankLine())
			}
			items = append(items, commentLine(t, 0))
			blank = false
		}
	}
	return verified(p, f.kind, items)
}

// The writes of an entry line: the values one line gives a list, together.
func statementWrites(values []entryWrite) []write {
	var out []write
	for _, e := range values {
		v := e.value
		if e.index < 0 && isDefault(e.placed.desc, v) {
			v = protoreflect.Value{}
		}
		if n := len(out); n > 0 && out[n-1].placed == e.placed && e.placed.isList() && e.placed.Printed != "message" {
			out[n-1].values = append(out[n-1].values, v)
			out[n-1].indices = append(out[n-1].indices, e.index)
			continue
		}
		out = append(out, write{placed: e.placed, values: []protoreflect.Value{v}, indices: []int{e.index}})
	}
	return out
}

func commentLine(c trivia, indent int) *item {
	return &item{line: strings.Repeat(" ", indent) + trailingText(c)}
}

func trailingText(c trivia) string { return "//" + strings.TrimRightFunc(c.text, isJSSpace) }

// Whether ECMAScript's trimEnd removes r: its white space and line terminators.
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\v', '\f', ' ', '\u00a0', '\ufeff', '\n', '\r', '\u2028', '\u2029':
		return true
	}
	return unicode.Is(unicode.Zs, r)
}
