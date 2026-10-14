package siml

import (
	"strings"
	"unicode"

	"github.com/wowsims/forever/sim/core/proto"
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
	p := &printer{ix: ix, names: f.typer.names, class: f.typer.class, declarations: declaredNames(f.declarations), calls: map[*proto.APLValue]string{}}
	for v, c := range f.typer.defs.values {
		p.calls[v] = nodeText(c, tree.lines.src)
	}
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
		// A when block's body goes 2 deeper than its when line.
		var in *whenStmt
		switch s := s.(type) {
		case *rowStmt:
			in = s.when
		case *whenStmt:
			in = s.parent
		}
		for ; in != nil; in = in.parent {
			indent += indentWidth
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
			item := f.written[s]
			if s.when == nil || rawRow(s) != nil || !item.IsValid() {
				add(p.row(item, section.name == sectionPrepull, sc, indent))
				break
			}
			// A row of a when block writes its own condition, and reads back as the row it is joined into.
			row := item.Interface().(*proto.APLListItem)
			own := &proto.APLListItem{Hide: s.hide, Notes: row.Notes, Action: &proto.APLAction{Action: row.Action.Action, Condition: ownCondition(s, row.Action.Condition)}}
			st := p.row(own.ProtoReflect(), false, sc, indent)
			if c := own.Action.Condition; c != nil && len(conjuncts(s.action.condition)) == 1 && len(st.parts) > 1 {
				st.parts = append(st.parts[:1], p.conjunctParts(c.ProtoReflect(), sc)...)
			}
			st.expect = p.row(item, false, sc, indent).expect
			add(st)
		case *whenStmt:
			add(p.whenLine(f.whens[s].ProtoReflect(), len(conjuncts(s.condition)) > 1, s.hide, sc, indent))
		case *defStmt:
			add(defLine(s, tree.lines.src, indent))
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

// `if c` for a condition written as one conjunct: an and in parentheses, which the join of a when block would take
// apart otherwise (SPEC.md §6.9).
func (p *printer) conjunctParts(c protoreflect.Message, sc scope) []text {
	if op, _, ok := p.infix(c, sc); ok && op == "and" {
		return []text{cat(word("if "), p.value(c, precAnd+1, sc))}
	}
	return p.conditionParts(c, sc)
}

// `when c:`, or `# when c:` for a hidden block. split writes c's and as the conjuncts it joins to its rows, and
// otherwise c is one conjunct, an and in parentheses (SPEC.md §6.9).
func (p *printer) whenLine(c protoreflect.Message, split, hide bool, sc scope, indent int) *printedStmt {
	parts := p.conditionParts(c, sc)
	if !split {
		parts = p.conjunctParts(c, sc)
	}
	lead := "when "
	if hide {
		lead = "# when "
	}
	parts[0] = cat(word(lead), parts[0][1:])
	parts[len(parts)-1] = cat(parts[len(parts)-1], word(":"))
	return &printedStmt{indent: indent, parts: parts}
}

// `def name(p, …) = value`, the value as it is written and broken as a var line's value is (SPEC.md §12.3).
func defLine(s *defStmt, src string, indent int) *printedStmt {
	head := "def " + s.name.text
	if len(s.params) > 0 {
		params := make([]string, len(s.params))
		for i, p := range s.params {
			params[i] = p.text
		}
		head += "(" + strings.Join(params, ", ") + ")"
	}
	parts := []text{word(head + " =")}
	l, ok := s.value.(*logicNode)
	if !ok {
		return &printedStmt{indent: indent, parts: append(parts, word(nodeText(s.value, src)))}
	}
	for i, o := range l.operands {
		t := nodeText(o, src)
		if i > 0 {
			t = l.op + " " + t
		}
		parts = append(parts, word(t))
	}
	return &printedStmt{indent: indent, parts: parts}
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
