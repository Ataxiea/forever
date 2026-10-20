package cmd

import (
	"io"
	"os"

	"github.com/wowsims/forever/sim/siml"
)

// siml.llm.txt, a short guide to SIML with every action, value and accessor the protos give:
//
//	go run ./cmd/wowsimcli siml llm -o siml.llm.txt
//
// With no -o it writes to stdout. make siml writes it.
func simlLLM(out, errOut io.Writer, args []string) error {
	flags := newFlags("llm [-o <file>]", errOut)
	output := flags.String("o", "", "the file to write; stdout when empty")
	if err := parseFlags(flags, args, 0); err != nil {
		return err
	}
	text, err := siml.LLMText()
	if err != nil {
		return err
	}
	if *output == "" {
		_, err = io.WriteString(out, text)
		return err
	}
	return os.WriteFile(*output, []byte(text), 0o644)
}
