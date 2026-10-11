package lsp

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/wowsims/forever/sim/siml"
)

// The requests of the protocol and the panel's own, each answered from the document's analysis.
func (s *server) request(ctx context.Context, method string, params json.RawMessage) (any, *ResponseError) {
	if strings.HasPrefix(method, "siml/") {
		return s.panelRequest(ctx, method, params)
	}
	var p textDocumentParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, invalidParams(err)
	}
	uri := p.TextDocument.URI
	switch method {
	case "textDocument/hover":
		return s.hover(uri, p.Position)
	case "textDocument/completion":
		catalog := s.readCatalog(uri)
		return s.withDoc(uri, []CompletionItem{}, func(a *analysis) any {
			items := []CompletionItem{}
			for _, c := range a.doc.Complete(fromPosition(p.Position), catalog.of(a)) {
				items = append(items, completionItem(c))
			}
			return items
		})
	case "textDocument/definition":
		return s.withDoc(uri, []Location{}, func(a *analysis) any {
			return s.locationsLocked(a, uri, a.doc.Definition(fromPosition(p.Position)))
		})
	case "textDocument/references":
		return s.withDoc(uri, []Location{}, func(a *analysis) any {
			return s.locationsLocked(a, uri, a.doc.References(fromPosition(p.Position), p.Context.IncludeDeclaration))
		})
	case "textDocument/prepareRename":
		s.mu.Lock()
		defer s.mu.Unlock()
		if a := s.analyzeLocked(uri); a != nil && a.doc != nil {
			return s.prepareRenameLocked(a, p.Position)
		}
		return nil, nil
	case "textDocument/rename":
		s.mu.Lock()
		defer s.mu.Unlock()
		if a := s.analyzeLocked(uri); a != nil && a.doc != nil {
			return s.renameLocked(a, uri, p.Position, p.NewName)
		}
		return nil, nil
	case "textDocument/documentSymbol":
		return s.withDoc(uri, []DocumentSymbol{}, func(a *analysis) any { return nonNil(documentSymbols(a.doc.Symbols())) })
	case "textDocument/foldingRange":
		return s.withDoc(uri, []FoldingRange{}, func(a *analysis) any {
			out := []FoldingRange{}
			for _, f := range a.doc.Folds() {
				if f.EndLine > f.StartLine {
					out = append(out, FoldingRange{StartLine: f.StartLine - 1, EndLine: f.EndLine - 1, Kind: f.Kind})
				}
			}
			return out
		})
	case "textDocument/documentLink":
		return s.withDoc(uri, []DocumentLink{}, func(a *analysis) any {
			out := []DocumentLink{}
			for _, link := range a.doc.Links() {
				out = append(out, DocumentLink{Range: toRange(link.Range), Target: s.uriOfLocked(link.Path)})
			}
			return out
		})
	case "textDocument/semanticTokens/full":
		return s.withDoc(uri, SemanticTokens{Data: []uint32{}}, func(a *analysis) any { return semanticTokens(a.doc) })
	case "textDocument/formatting":
		return s.withDoc(uri, []TextEdit{}, func(a *analysis) any { return formatting(a) })
	case "textDocument/codeAction":
		catalog := s.readCatalog(uri)
		return s.withDoc(uri, []CodeAction{}, func(a *analysis) any {
			out := []CodeAction{}
			for _, fix := range a.doc.QuickFixes(fromRange(p.Range), catalog.of(a)) {
				action := CodeAction{
					Title:       fix.Title,
					Kind:        fix.Kind,
					IsPreferred: fix.Preferred,
					Edit:        &WorkspaceEdit{Changes: map[string][]TextEdit{uri: toTextEdits(fix.Edits)}},
				}
				if fix.Diagnostic.Code != "" {
					action.Diagnostics = []Diagnostic{s.toDiagnosticLocked(fix.Diagnostic)}
				}
				out = append(out, action)
			}
			return out
		})
	}
	return nil, &ResponseError{Code: codeMethodNotFound, Message: "method not found: " + method}
}

// Answers from the open document's analysis, or with empty when the document is not open or does not read.
func (s *server) withDoc(uri string, empty any, answer func(a *analysis) any) (any, *ResponseError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.analyzeLocked(uri)
	if a == nil || a.doc == nil {
		return empty, nil
	}
	return answer(a), nil
}

// The catalog of a document's repository, read without holding the server: the first read, and the first after the
// database files change, parses the 3 MB db.json.
type catalogRead struct {
	root    string
	catalog *siml.DatabaseCatalog
}

func (s *server) readCatalog(uri string) catalogRead {
	s.mu.Lock()
	a := s.analyzeLocked(uri)
	open := a != nil && a.doc != nil
	root := ""
	if open {
		root = a.root
	}
	s.mu.Unlock()
	if !open {
		return catalogRead{}
	}
	return catalogRead{root: root, catalog: siml.CatalogAt(root)}
}

// The catalog for the analysis an answer reads, which is read again, under the lock, only when the document left or
// changed repository in between.
func (c catalogRead) of(a *analysis) *siml.DatabaseCatalog {
	if c.catalog != nil && c.root == a.root {
		return c.catalog
	}
	return siml.CatalogAt(a.root)
}

// The URI of a file: the open document's, else its file: URI.
func (s *server) uriOfLocked(path string) string {
	if d := s.docByPathLocked(path); d != nil {
		return d.uri
	}
	return pathURI(path)
}

// A hover, with the game files' row of the spell it is about appended. The catalog is read without holding the
// server.
func (s *server) hover(uri string, at Position) (any, *ResponseError) {
	catalog := s.readCatalog(uri)
	h, ok := func() (siml.Hover, bool) {
		s.mu.Lock()
		defer s.mu.Unlock()
		a := s.analyzeLocked(uri)
		if a == nil || a.doc == nil {
			return siml.Hover{}, false
		}
		return a.doc.Hover(fromPosition(at), catalog.of(a))
	}()
	if !ok {
		return nil, nil
	}
	markdown := h.Markdown
	if h.SpellID > 0 {
		if row, ok := s.cards.row(h.SpellID); ok && row != "" {
			markdown += "\n\n```text\n" + row + "\n```"
		}
	}
	out := Hover{Contents: MarkupContent{Kind: "markdown", Value: markdown}}
	if h.Range != (siml.Range{}) {
		r := toRange(h.Range)
		out.Range = &r
	}
	return out, nil
}

// The tokens as the protocol encodes them: each one's line and start relative to the one before, its length, its
// type and its modifiers as bits of the legend. A token over several lines is sent a line at a time.
func semanticTokens(d *siml.Doc) SemanticTokens {
	types, modifiers := map[string]uint32{}, map[string]uint32{}
	for i, t := range siml.TokenTypes() {
		types[t] = uint32(i)
	}
	for i, m := range siml.TokenModifiers() {
		modifiers[m] = 1 << i
	}
	lines := strings.Split(d.Text(), "\n")
	lineLength := func(line int) int {
		if line < 0 || line >= len(lines) {
			return 0
		}
		return utf16Len(strings.TrimSuffix(lines[line], "\r"))
	}
	tokens := slices.Clone(d.Tokens())
	slices.SortStableFunc(tokens, func(a, b siml.Token) int {
		if a.Range.Start.Line != b.Range.Start.Line {
			return a.Range.Start.Line - b.Range.Start.Line
		}
		return a.Range.Start.Col - b.Range.Start.Col
	})
	data := []uint32{}
	prevLine, prevChar := 0, 0
	emit := func(line, char, length int, kind, mods uint32) {
		if length <= 0 {
			return
		}
		deltaChar := char
		if line == prevLine {
			deltaChar = char - prevChar
		}
		data = append(data, uint32(line-prevLine), uint32(deltaChar), uint32(length), kind, mods)
		prevLine, prevChar = line, char
	}
	for _, t := range tokens {
		kind, ok := types[t.Type]
		if !ok {
			continue
		}
		var mods uint32
		for _, m := range t.Modifiers {
			mods |= modifiers[m]
		}
		r := toRange(t.Range)
		for line := r.Start.Line; line <= r.End.Line; line++ {
			start, end := 0, lineLength(line)
			if line == r.Start.Line {
				start = r.Start.Character
			}
			if line == r.End.Line {
				end = r.End.Character
			}
			emit(line, start, end-start, kind, mods)
		}
	}
	return SemanticTokens{Data: data}
}

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n += len(utf16.Encode([]rune{r}))
	}
	return n
}

// The file as format writes it (SPEC.md §12.1), as the one smallest edit that turns the text into it, so the editor
// keeps the cursor and folding outside it and undo restores it in one step; none while the text has an error.
func formatting(a *analysis) []TextEdit {
	text := a.doc.Text()
	formatted, err := siml.Format(a.doc.Path(), []byte(text), a.names)
	if err != nil {
		return []TextEdit{}
	}
	after := string(formatted)
	if after == text {
		return []TextEdit{}
	}
	start := 0
	for start < len(text) && start < len(after) && text[start] == after[start] {
		start++
	}
	for start > 0 && start < len(text) && !utf8.RuneStart(text[start]) {
		start--
	}
	tail := 0
	for tail < len(text)-start && tail < len(after)-start && text[len(text)-1-tail] == after[len(after)-1-tail] {
		tail++
	}
	for tail > 0 && !utf8.RuneStart(text[len(text)-tail]) {
		tail--
	}
	r := siml.Range{Start: a.doc.Position(start), End: a.doc.Position(len(text) - tail)}
	return []TextEdit{{Range: toRange(r), NewText: after[start : len(after)-tail]}}
}
