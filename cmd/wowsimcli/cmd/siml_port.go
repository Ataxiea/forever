package cmd

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/wowsims/forever/sim/core/proto"
	"github.com/wowsims/forever/sim/siml"
)

// The JSON preset kinds a port reads, each with the SIML file it writes and the kind it prints.
var portedSuffixes = []struct{ json, siml, printed string }{
	{".apl.json", ".apl.siml", "print.apl.siml"},
	{".gear.json", ".gear.siml", "print.gear.siml"},
	{".build.json", ".siml", "print.siml"},
}

func simlPort(out, errOut io.Writer, args []string) error {
	flags := newFlags("port [-keep] <files or folders>", errOut)
	keep := flags.Bool("keep", false, "keep each JSON file once its SIML reads back as it")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() == 0 {
		return errors.New("port takes the JSON files or folders to port")
	}
	files, err := portedFiles(flags.Args())
	if err != nil {
		return err
	}
	names, err := siml.DefaultNames()
	if err != nil {
		return err
	}
	failed := 0
	for _, path := range files {
		how, err := portFile(path, names)
		if err == nil && !*keep {
			err = os.Remove(path)
		}
		if err != nil {
			fmt.Fprintf(errOut, "%s: %v\n", path, err)
			failed++
			continue
		}
		fmt.Fprintf(out, "%s: %s\n", path, how)
	}
	if failed > 0 {
		return fmt.Errorf("%d of %d JSON files are not ported", failed, len(files))
	}
	return nil
}

// Writes the SIML twin of the JSON preset at path, and says how: a rotation is spliced into its x.apl.siml, and a
// build into its x.siml, which keeps every line that still says the same; a gear set, or a file with no twin, is
// printed whole.
func portFile(path string, names *siml.Names) (string, error) {
	i := slices.IndexFunc(portedSuffixes, func(s struct{ json, siml, printed string }) bool { return strings.HasSuffix(path, s.json) })
	suffix := portedSuffixes[i]
	target := strings.TrimSuffix(path, suffix.json) + suffix.siml
	kind, err := siml.KindOf(suffix.printed)
	if err != nil {
		return "", err
	}
	m := kind.Message()
	if err := readJSON(path, m); err != nil {
		return "", err
	}
	settings := siml.SettingsOf(m)
	old, err := os.ReadFile(target)
	exists := err == nil
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}

	var text []byte
	how := "printed as " + filepath.Base(target)
	switch rotation, isRotation := m.(*proto.APLRotation); {
	case exists && isRotation:
		doc := siml.Analyze(target, old, names, siml.ReadSource)
		if edits, err := doc.Port(rotation); err == nil {
			text = appliedEdits(doc, edits)
			how = fmt.Sprintf("spliced into %s, %d statements printed again", filepath.Base(target), len(edits))
		} else {
			how = fmt.Sprintf("printed again as %s, which keeps none of its own lines (%v)", filepath.Base(target), err)
		}
	case exists && kind.Section == "":
		// A full setup may take sections from other files and load over its spec's defaults: its own rotation is
		// spliced, each other category it writes itself is printed again where it differs, and a category that differs
		// but comes from elsewhere is left to a hand edit.
		doc := siml.Analyze(target, old, names, siml.ReadSource)
		edits, err := doc.Port(settings.GetPlayer().GetRotation())
		if err != nil {
			return "", fmt.Errorf("%s is left as it is, to port by hand: %v", filepath.Base(target), err)
		}
		doc = siml.Analyze(target, appliedEdits(doc, edits), names, siml.ReadSource)
		setup, left, err := doc.PortSetup(settings)
		if err != nil {
			return "", fmt.Errorf("%s is left as it is, to port by hand: %v", filepath.Base(target), err)
		}
		if text, err = siml.Format(target, appliedEdits(doc, setup), names); err != nil {
			return "", fmt.Errorf("the ported %s does not read: %w", filepath.Base(target), err)
		}
		how = fmt.Sprintf("spliced into %s, %d rotation statements and %d other parts printed again", filepath.Base(target), len(edits), len(setup))
		if len(left) > 0 {
			f, err := siml.Parse(target, text, names, siml.ReadSource)
			if err != nil {
				return "", fmt.Errorf("the ported %s does not read: %w", filepath.Base(target), err)
			}
			if err := os.WriteFile(target, text, 0o644); err != nil {
				return "", err
			}
			return "", fmt.Errorf("%s; the categories %s differ but come from other files or the spec's defaults, so edit them by hand, then delete the JSON:\n  %s",
				how, strings.Join(left, ", "), strings.Join(readBackDifferences(m, f, names), "\n  "))
		}
	case exists:
		how = "printed again as " + filepath.Base(target) + ", which keeps none of its own lines"
	}
	if text == nil {
		spec, err := portSpec(path, kind, settings, old, names)
		if err != nil {
			return "", err
		}
		text = siml.Print(kind, spec, settings, nil, names)
	}

	f, err := siml.Parse(target, text, names, siml.ReadSource)
	if err != nil {
		return "", fmt.Errorf("the SIML does not read: %w", err)
	}
	if diffs := readBackDifferences(m, f, names); len(diffs) > 0 {
		return "", fmt.Errorf("the SIML does not read back as the JSON:\n  %s", strings.Join(diffs, "\n  "))
	}
	if err := os.WriteFile(target, text, 0o644); err != nil {
		return "", err
	}
	for _, r := range f.RawRefs {
		how += fmt.Sprintf("; raw JSON at %d:%d, where the name table has no name", r.Start.Line, r.Start.Col)
	}
	return how, nil
}

// The spec a printed file writes: the one its SIML twin names, a full setup's player's, or that of the defaults.siml
// of the spec folder the file sits in, ui/specs/<class>/<spec>/<folder>/<file>.
func portSpec(path string, kind siml.Kind, settings *proto.IndividualSimSettings, old []byte, names *siml.Names) (proto.Spec, error) {
	if spec := heldSpec(settings); spec != proto.Spec_SpecUnknown {
		return spec, nil
	}
	if old != nil {
		if f, err := siml.Parse(path, old, names, siml.ReadSource); err == nil && f.Spec != proto.Spec_SpecUnknown {
			return f.Spec, nil
		}
	}
	defaults := filepath.Join(filepath.Dir(filepath.Dir(path)), "defaults.siml")
	f, err := siml.ReadFile(defaults)
	if err != nil {
		if strings.HasSuffix(path, ".gear.json") {
			return proto.Spec_SpecUnknown, nil
		}
		return proto.Spec_SpecUnknown, fmt.Errorf("no spec to print it for: %w", err)
	}
	return f.Spec, nil
}

// The doc's text with edits applied.
func appliedEdits(doc *siml.Doc, edits []siml.TextEdit) []byte {
	text := doc.Text()
	for _, e := range slices.Backward(edits) {
		text = text[:doc.Offset(e.Range.Start)] + e.NewText + text[doc.Offset(e.Range.End):]
	}
	return []byte(text)
}

// The JSON presets args name: each file, and every one under each folder, skipping node_modules and hidden folders.
func portedFiles(args []string) ([]string, error) {
	ported := func(path string) bool {
		return slices.ContainsFunc(portedSuffixes, func(s struct{ json, siml, printed string }) bool { return strings.HasSuffix(path, s.json) })
	}
	var files []string
	for _, arg := range args {
		info, err := os.Stat(arg)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			if !ported(arg) {
				return nil, fmt.Errorf("%s is no .apl.json, .gear.json or .build.json", arg)
			}
			files = append(files, arg)
			continue
		}
		err = filepath.WalkDir(arg, func(path string, d fs.DirEntry, err error) error {
			switch {
			case err != nil:
				return err
			case d.IsDir() && path != arg && (d.Name() == "node_modules" || strings.HasPrefix(d.Name(), ".")):
				return filepath.SkipDir
			case !d.IsDir() && ported(path):
				files = append(files, path)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return files, nil
}
