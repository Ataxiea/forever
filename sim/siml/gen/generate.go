package gen

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

// The committed table, relative to the repository's root.
const TablePath = "sim/siml/names.json"

// The command that regenerates the committed table.
const MakeCommand = "make sim/siml/names.json"

// Reads the committed table under root, collects what the sim and the database hold, and returns the table the
// committed one grows into, with pin handed back to the new-name rules when it is not nil.
func Generate(root string, pin *Pin) (*siml.Names, *Report, error) {
	data, err := os.ReadFile(filepath.Join(root, TablePath))
	if err != nil {
		return nil, nil, err
	}
	old, err := siml.ParseNames(data)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: %w; it is generated, so take the committed one and run %s", TablePath, err, MakeCommand)
	}
	c, err := Collect(root, old)
	if err != nil {
		return nil, nil, err
	}
	return Update(old, c, pin)
}

// The .siml files under root/ui/specs that write the name pin holds and mean its entry by it, relative to root: every
// committed file whose meaning a repin of the name can change. The files are read with the committed table, and a
// class's name is meant only in a file of that class.
func FilesUsing(root string, pin Pin) ([]string, error) {
	data, err := os.ReadFile(filepath.Join(root, TablePath))
	if err != nil {
		return nil, err
	}
	names, err := siml.ParseNames(data)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", TablePath, err)
	}
	var files []string
	err = filepath.WalkDir(filepath.Join(root, "ui", "specs"), func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".siml") {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		f, err := siml.Parse(path, src, names, os.ReadFile)
		if diags := (siml.Diagnostics{}); err != nil && !errors.As(err, &diags) {
			return err
		}
		if !means(f, pin) {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	return files, err
}

// Whether f writes the name pin holds, and means pin's entry by it.
func means(f *siml.File, pin Pin) bool {
	if pin.Class != proto.Class_ClassUnknown {
		if info, ok := siml.SpecOf(f.Spec); !ok || info.Class != pin.Class {
			return false
		}
	}
	return slices.ContainsFunc(f.Names, func(r siml.NameRef) bool { return r.Name == pin.Name && r.Namespace == pin.Namespace })
}

// Writes the report: the entries added, or their count by scope unless verbose; the new class entries a shared name
// holds the plain name of; the repinned names; the stale pinned names; and what could not be built, or its count
// unless verbose.
func (r *Report) Write(w io.Writer, verbose bool) {
	if verbose || len(r.Added) <= 50 {
		for _, line := range r.Added {
			fmt.Fprintln(w, "added", line)
		}
	} else {
		counts := map[string]int{}
		var scopes []string
		for _, line := range r.Added {
			scope := line[:strings.LastIndexByte(line[:strings.Index(line, " = ")], '.')]
			if counts[scope] == 0 {
				scopes = append(scopes, scope)
			}
			counts[scope]++
		}
		for _, scope := range scopes {
			fmt.Fprintf(w, "added %d names to %s\n", counts[scope], scope)
		}
		fmt.Fprintln(w, "(-v lists them)")
	}
	for _, line := range r.Qualified {
		fmt.Fprintln(w, "qualified:", line)
	}
	for _, p := range r.Repinned {
		fmt.Fprintf(w, "repinned %s: was %s, now %s\n", p.Pin, p.Was, p.Now)
	}
	for _, line := range r.Stale {
		fmt.Fprintln(w, "stale:", line)
	}
	if r.Unregistered > 0 {
		fmt.Fprintf(w, "%d pinned spell and aura names are registered by no build\n", r.Unregistered)
	}
	if verbose {
		for _, line := range r.Skipped {
			fmt.Fprintln(w, "skipped", line)
		}
	} else if len(r.Skipped) > 0 {
		fmt.Fprintf(w, "skipped %d specs and sources the sim cannot build (-v lists them)\n", len(r.Skipped))
	}
}
