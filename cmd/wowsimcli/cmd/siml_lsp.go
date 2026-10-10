package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/wowsims/forever/sim/siml/lsp"
)

// The SIML language server on stdin and stdout, which the VS Code extension starts:
//
//	go run --tags=with_db ./cmd/wowsimcli siml lsp
//
// It reads the name table and the item database from the repository each file sits in, so it checks files without
// the with_db tag; siml/sim needs the tag, as `siml sim` does. It exits when the client sends exit or closes stdin,
// with status 1 when no shutdown came first.
func simlLSP(out, errOut io.Writer, args []string) error {
	flags := newFlags("lsp [-stdio]", errOut)
	flags.Bool("stdio", true, "serve on stdin and stdout (the only transport)")
	if err := parseFlags(flags, args, 0); err != nil {
		return err
	}
	// The protocol owns stdout: anything else printed, such as a sim's log line, goes to stderr.
	if out == os.Stdout {
		os.Stdout = os.Stderr
	}
	shutdown, err := lsp.Serve(os.Stdin, out, lsp.Options{Sim: simlSimJSON})
	if err != nil {
		return err
	}
	if !shutdown {
		return errors.New("the client exited without a shutdown")
	}
	return nil
}

// One sim at a time: the sim's row counts go through a hook all sims share.
var simlSimSlot = make(chan struct{}, 1)

// Runs a `siml sim` request for the language server: the request and the result as `siml sim` reads and writes them.
func simlSimJSON(ctx context.Context, root string, request json.RawMessage) (result json.RawMessage, err error) {
	req, err := readRequest(bytes.NewReader(request))
	if err != nil {
		return nil, fmt.Errorf("reading the request: %w", err)
	}
	select {
	case simlSimSlot <- struct{}{}:
		defer func() { <-simlSimSlot }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() {
		if r := recover(); r != nil {
			result, err = nil, fmt.Errorf("the sim panicked: %v", r)
		}
	}()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	res := runSimlSim(ctx, root, req)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return json.Marshal(res)
}
