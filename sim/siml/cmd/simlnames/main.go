// Generates the SIML name table (sim/siml/SPEC.md §7.4) from what the sim registers and the database, keeping
// every name the committed table holds, and reports what it added on standard error.
//
//	go run --tags=with_db ./sim/siml/cmd/simlnames -w (or make sim/siml/names.json)
//	go run --tags=with_db ./sim/siml/cmd/simlnames -w -repin warrior.aura.overpower
package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wowsims/forever/sim/siml/gen"
)

var (
	write   = flag.Bool("w", false, "write the table to "+gen.TablePath+" instead of standard output")
	repin   = flag.String("repin", "", "hand <class>.<namespace>.<name>, shared.<namespace>.<name>, item.<name>, enchant.<name> or suffix.<name> back to the new-name rules, with the other names its game name gives")
	verbose = flag.Bool("v", false, "list every added entry")
)

func main() {
	flag.Parse()
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "simlnames: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	root, err := repositoryRoot()
	if err != nil {
		return err
	}
	var pin *gen.Pin
	if *repin != "" {
		p, err := gen.ParsePin(*repin)
		if err != nil {
			return err
		}
		pin = &p
	}
	table, report, err := gen.Generate(root, pin)
	if err != nil {
		return err
	}
	report.Write(os.Stderr, *verbose)
	for _, p := range report.Repinned {
		files, err := gen.FilesUsing(root, p.Pin)
		if err != nil {
			return err
		}
		for _, f := range files {
			fmt.Fprintf(os.Stderr, "%s uses %s, whose meaning the repin changes\n", f, p.Name)
		}
	}
	data := table.Encode()
	if !*write {
		_, err := os.Stdout.Write(data)
		return err
	}
	// Left alone when no entry changed, so what is built from the table is not rebuilt. Otherwise written whole and
	// renamed into place, so a failed run leaves the committed table as it was.
	path := filepath.Join(root, gen.TablePath)
	if old, err := os.ReadFile(path); err == nil && bytes.Equal(old, data) {
		return nil
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "names-*.json")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// The directory that holds go.mod, from the working directory up.
func repositoryRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("no go.mod above the working directory")
		}
		dir = parent
	}
}
