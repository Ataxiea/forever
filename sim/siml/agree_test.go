package siml

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/wowsims/forever/sim/core/proto"
	"google.golang.org/protobuf/encoding/protojson"
	googleProto "google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// The agreement test of SPEC.md §15: ui/sim/siml, run under node by testdata/agree.mjs, must read, format and print
// every corpus case and every committed ui/specs file exactly as this package does, and resolve the same names in the
// same namespaces. The corpus is read with the fixture table, and ui/specs with the committed one.

const (
	specsRoot  = "../../ui/specs"
	moduleRoot = "../../ui/sim/siml"
	tablePath  = "names.json" // The committed name table, read from disk so that no build tag is needed.
)

// A diagnostic as agree.mjs prints it.
type agreeDiagnostic struct {
	Line     int    `json:"line"`
	Col      int    `json:"col"`
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

// A name that means something, as agree.mjs prints it.
type agreeName struct {
	Line      int    `json:"line"`
	Col       int    `json:"col"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

// A line agree.mjs prints for one path.
type agreeLine struct {
	Path        string            `json:"path"`
	JSON        json.RawMessage   `json:"json"`
	Format      *string           `json:"format"`
	Print       *string           `json:"print"`
	Diagnostics []agreeDiagnostic `json:"diagnostics"`
	RawRefs     []agreeDiagnostic `json:"rawRefs"`
	Names       []agreeName       `json:"names"`
	Spans       []string          `json:"spans"`
	Refs        []string          `json:"refs"`
}

// The diagnostics as the lines of a .diag file, with the message of each, except bad-raw, whose text comes from each
// language's JSON reader.
func agreeLines(diags []agreeDiagnostic) []string {
	lines := make([]string, len(diags))
	for i, d := range diags {
		lines[i] = fmt.Sprintf("%d:%d %s %s", d.Line, d.Col, d.Severity, d.Code)
		if d.Code != "bad-raw" {
			lines[i] += ": " + d.Message
		}
	}
	return lines
}

// The lines agreeLines gives for a Go parse's diagnostics.
func goAgreeLines(diags Diagnostics) []string {
	out := make([]agreeDiagnostic, len(diags))
	for i, d := range diags {
		out[i] = agreeDiagnostic{d.Start.Line, d.Start.Col, d.Severity.String(), d.Code, d.Message}
	}
	return agreeLines(out)
}

// The names as "LINE:COL namespace name" lines.
func nameLines(names []agreeName) []string {
	lines := make([]string, len(names))
	for i, n := range names {
		lines[i] = fmt.Sprintf("%d:%d %s %s", n.Line, n.Col, n.Namespace, n.Name)
	}
	return lines
}

// The lines nameLines gives for a Go parse's names.
func goNameLines(f *File) []string {
	out := make([]agreeName, len(f.Names))
	for i, n := range f.Names {
		out[i] = agreeName{n.Start.Line, n.Start.Col, n.Name, string(n.Namespace)}
	}
	return nameLines(out)
}

// A range as agree.mjs prints it: "LINE:COL-LINE:COL".
func agreeRange(r Range) string {
	return fmt.Sprintf("%d:%d-%d:%d", r.Start.Line, r.Start.Col, r.End.Line, r.End.Col)
}

func agreePath(path []any) string {
	parts := make([]string, len(path))
	for i, k := range path {
		parts[i] = fmt.Sprint(k)
	}
	return strings.Join(parts, "/")
}

// A Doc's spans as agree.mjs prints a parse's.
func goSpanLines(d *Doc) []string {
	lines := []string{}
	for _, s := range d.Spans() {
		lines = append(lines, agreeRange(s.Range)+" "+agreePath(s.Path))
	}
	return lines
}

// A Doc's refs as agree.mjs prints a parse's.
func goRefLines(d *Doc) []string {
	lines := []string{}
	for _, r := range d.Refs() {
		path := "-"
		if r.Path != nil {
			path = agreePath(r.Path)
		}
		lines = append(lines, fmt.Sprintf("%s %s %s %s", agreeRange(Range{r.Start, r.End}), r.Namespace, r.Name, path))
	}
	return lines
}

// Every .siml under ui/specs.
func committedFiles(t *testing.T) []string {
	t.Helper()
	var files []string
	err := filepath.WalkDir(specsRoot, func(path string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(path, ".siml") {
			files = append(files, path)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

// Runs agree.mjs over paths with the name table at names, with --print when print is set, and returns its lines by
// path.
func runAgree(t *testing.T, node, schema, names string, print bool, paths []string) map[string]agreeLine {
	t.Helper()
	if len(paths) == 0 {
		return nil
	}
	args := []string{"--experimental-strip-types", filepath.Join("testdata", "agree.mjs"), "--schema", schema, "--names", names}
	if print {
		args = append(args, "--print")
	}
	var stdout, stderr bytes.Buffer
	cmd := exec.Command(node, append(args, paths...)...)
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("node %s: %v\n%s", strings.Join(args, " "), err, stderr.Bytes())
	}
	lines := map[string]agreeLine{}
	scanner := bufio.NewScanner(&stdout)
	scanner.Buffer(nil, 1<<26)
	for scanner.Scan() {
		var line agreeLine
		if err := json.Unmarshal(scanner.Bytes(), &line); err != nil {
			t.Fatalf("agree.mjs printed a line that is no JSON: %v\n%s", err, scanner.Bytes())
		}
		lines[line.Path] = line
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return lines
}

// Compares what agree.mjs gives for the file at path, whose text is src, with Go's parse and format of it.
func agree(t *testing.T, ts agreeLine, path string, src []byte, names *Names, open Opener) {
	t.Helper()
	f, err := Parse(path, src, names, open)
	if got, want := goAgreeLines(diagnosticsOf(t, f, err)), agreeLines(ts.Diagnostics); !slices.Equal(got, want) {
		t.Errorf("the diagnostics differ\ngo:\n%s\nts:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	if got, want := goAgreeLines(f.RawRefs), agreeLines(ts.RawRefs); !slices.Equal(got, want) {
		t.Errorf("the raw refs differ\ngo:\n%s\nts:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	if got, want := goNameLines(f), nameLines(ts.Names); !slices.Equal(got, want) {
		t.Errorf("the names differ\ngo:\n%s\nts:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	doc := Analyze(path, src, names, open)
	if got := goSpanLines(doc); !slices.Equal(got, ts.Spans) {
		t.Errorf("the spans differ\ngo:\n%s\nts:\n%s", strings.Join(got, "\n"), strings.Join(ts.Spans, "\n"))
	}
	if got := goRefLines(doc); !slices.Equal(got, ts.Refs) {
		t.Errorf("the refs differ\ngo:\n%s\nts:\n%s", strings.Join(got, "\n"), strings.Join(ts.Refs, "\n"))
	}

	switch tsLoaded := string(ts.JSON) != "null"; {
	case err != nil && tsLoaded:
		t.Errorf("only ts loads the file: %s", ts.JSON)
	case err == nil && !tsLoaded:
		t.Errorf("only go loads the file: %s", protojson.Format(loaded(f)))
	case err == nil:
		m := loaderMessage(f.Kind)
		if err := protojson.Unmarshal(ts.JSON, m); err != nil {
			t.Fatalf("the ts json does not read as %T: %v\n%s", m, err, ts.JSON)
		}
		if !googleProto.Equal(loaded(f), m) {
			t.Errorf("the loaded messages differ\ngo: %s\nts: %s", protojson.Format(loaded(f)), protojson.Format(m))
		}
	}

	formatted, err := Format(path, src, names)
	switch {
	case err != nil && ts.Format != nil:
		t.Errorf("only ts formats the file (go: %v)", err)
	case err == nil && ts.Format == nil:
		t.Errorf("only go formats the file")
	case err == nil && string(formatted) != *ts.Format:
		t.Errorf("the formats differ\ngo:\n%s\nts:\n%s", formatted, *ts.Format)
	}
}

// The property test's rotations as print cases in dir: for each action and value kind, a hunter rotation whose one
// row holds the kind with every field set, and one with none set.
func kindPrintCases(t *testing.T, dir string) []string {
	t.Helper()
	ix, err := loadIndex()
	if err != nil {
		t.Fatal(err)
	}
	var files []string
	write := func(name string, row *proto.APLListItem) {
		r := &proto.APLRotation{Type: proto.APLRotation_TypeAPL, PriorityList: []*proto.APLListItem{row}}
		file := filepath.Join(dir, "hunter_"+name+".apl.json")
		if err := os.WriteFile(file, []byte(protojson.Format(r)), 0o644); err != nil {
			t.Fatal(err)
		}
		files = append(files, file)
	}
	for _, k := range ix.actionKinds {
		write("action_"+k.Kind, &proto.APLListItem{Action: kindAction(k, kindSample(t, ix, k))})
		write("action_"+k.Kind+"_empty", &proto.APLListItem{Action: kindAction(k, newMessage(k.message.desc))})
	}
	for _, k := range ix.valueKindList {
		for name, body := range map[string]protoreflect.Message{k.Kind: kindSample(t, ix, k), k.Kind + "_empty": newMessage(k.message.desc)} {
			write("value_"+name, &proto.APLListItem{Action: &proto.APLAction{
				Condition: kindValue(k, body),
				Action:    &proto.APLAction_CastSpell{CastSpell: &proto.APLActionCastSpell{SpellId: sampleSpell}},
			}})
		}
	}
	slices.Sort(files)
	return files
}

// Every parse, format and errors case, every print case, every kind of the property test and every committed ui/specs
// file reads, formats and prints the same in both implementations.
func TestAgreement(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatalf("the agreement test runs ui/sim/siml with node, which is not on PATH: %v", err)
	}
	schema := filepath.Join(t.TempDir(), "schema.json")
	var buf bytes.Buffer
	if err := WriteSchema(&buf); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(schema, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	// go test caches a passing run by the files the test itself reads, and node reads the module: reading its files
	// here makes a change to them run the test again.
	if err := filepath.WalkDir(moduleRoot, func(path string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			_, err = os.ReadFile(path)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.ReadFile(filepath.Join("testdata", "agree.mjs")); err != nil {
		t.Fatal(err)
	}

	fixture := filepath.Join("testdata", "names.json")
	corpus := slices.Concat(corpusCases(t, "parse", ".siml"), corpusCases(t, "format", ".siml"), corpusCases(t, "errors", ".siml"))
	committed := committedFiles(t)
	prints := corpusCases(t, "print", ".json")
	kinds := kindPrintCases(t, t.TempDir())
	parsed := runAgree(t, node, schema, fixture, false, corpus)
	maps.Copy(parsed, runAgree(t, node, schema, tablePath, false, committed))
	printed := runAgree(t, node, schema, fixture, true, slices.Concat(prints, kinds))
	t.Logf("agreement over %d corpus files, %d committed files, %d print cases and %d kind samples", len(corpus), len(committed), len(prints), len(kinds))

	names := corpusNames(t)
	table := readNames(t, tablePath)
	for _, file := range slices.Concat(corpus, committed) {
		t.Run(strings.TrimPrefix(filepath.ToSlash(file), "../../"), func(t *testing.T) {
			ts, ok := parsed[file]
			if !ok {
				t.Fatal("agree.mjs printed no line for the file")
			}
			src, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if slices.Contains(committed, file) {
				agree(t, ts, file, src, table, os.ReadFile)
			} else {
				agree(t, ts, file, src, names, caseOpener(file))
			}
		})
	}

	for _, file := range slices.Concat(prints, kinds) {
		t.Run(strings.TrimPrefix(filepath.ToSlash(file), filepath.ToSlash(filepath.Dir(kinds[0]))+"/"), func(t *testing.T) {
			ts, ok := printed[file]
			if !ok || ts.Print == nil {
				t.Fatal("agree.mjs printed no print for the case")
			}
			target := strings.TrimSuffix(file, ".json") + ".siml"
			kind := kindOf(target)
			out := Print(kind, caseSpec(file), settingsOf(readMessage(t, file, kind)), caseCategories(file), names)
			if string(out) != *ts.Print {
				t.Fatalf("the prints differ\ngo:\n%s\nts:\n%s", out, *ts.Print)
			}
			agree(t, ts, target, out, names, os.ReadFile)
		})
	}
}
