// Writes the SIML schema the TypeScript module reads (sim/siml/SPEC.md §8), to standard output or to -o.
//
//	go run ./sim/siml/cmd/simlschema -o ui/generated/siml/schema.json (or make ui/generated/siml/schema.json)
package main

import (
	"bytes"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wowsims/forever/sim/siml"
)

var out = flag.String("o", "", "output path; standard output when empty")

func main() {
	flag.Parse()

	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "simlschema: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	var buf bytes.Buffer
	if err := siml.WriteSchema(&buf); err != nil {
		return err
	}
	if *out == "" {
		_, err := os.Stdout.Write(buf.Bytes())
		return err
	}
	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		return err
	}
	return os.WriteFile(*out, buf.Bytes(), 0o644)
}
