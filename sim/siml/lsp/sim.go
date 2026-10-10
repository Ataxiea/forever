package lsp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/wowsims/forever/sim/siml"
)

// siml/sim: a sim of an open .apl.siml's text with `wowsimcli siml sim`'s request, run by Options.Sim. A compare
// sims the saved file, or HEAD when the text is the saved file's, as the base, and the text against it on the same
// seed.

const (
	defaultIterations = 1000
	maxIterations     = 100000
)

type simParams struct {
	uri          string
	compare      bool
	settingsFile string
	iterations   int
	seed         int64
	timeline     bool
}

// The request `wowsimcli siml sim` reads.
type simRequest struct {
	SIML    string `json:"siml"`
	Path    string `json:"path"`
	Compare *struct {
		SIML string `json:"siml"`
	} `json:"compare,omitempty"`
	SettingsFile string `json:"settingsFile,omitempty"`
	Iterations   int    `json:"iterations"`
	Seed         int64  `json:"seed,omitempty"`
	Timeline     bool   `json:"timeline,omitempty"`
}

type simRun struct {
	DPS struct {
		Mean  float64 `json:"mean"`
		Stdev float64 `json:"stdev"`
	} `json:"dps"`
	Iterations int `json:"iterations"`
}

// The difference of a compare: compare minus base, and whether it is beyond the noise. Both runs share a seed, so
// their iterations are correlated and the error from independent samples overstates the noise.
type dpsDifference struct {
	Delta       float64 `json:"delta"`
	Percent     float64 `json:"percent"`
	Stderr      float64 `json:"stderr"`
	Z           float64 `json:"z"`
	Significant bool    `json:"significant"` // |z| at or above 1.96, about 95% confidence.
}

func difference(base, compare simRun) dpsDifference {
	delta := compare.DPS.Mean - base.DPS.Mean
	se := func(r simRun) float64 { return r.DPS.Stdev / math.Sqrt(float64(max(r.Iterations, 1))) }
	stderr := math.Hypot(se(base), se(compare))
	var z float64
	switch {
	case stderr > 0:
		z = delta / stderr
	case delta > 0:
		z = math.MaxFloat64
	case delta < 0:
		z = -math.MaxFloat64
	}
	d := dpsDifference{Delta: delta, Stderr: stderr, Z: z, Significant: math.Abs(z) >= 1.96}
	if base.DPS.Mean > 0 {
		d.Percent = delta / base.DPS.Mean * 100
	}
	return d
}

func (s *server) sim(ctx context.Context, p simParams) (any, *ResponseError) {
	if s.opts.Sim == nil {
		return nil, failed("%s", errNoSim.Error())
	}
	s.mu.Lock()
	a := s.analyzeLocked(p.uri)
	d := s.docs[p.uri]
	if a == nil || d == nil {
		s.mu.Unlock()
		return nil, failed("%s is not open", p.uri)
	}
	if a.err != nil || d.path == "" || a.doc.Kind().Section != "apl" {
		s.mu.Unlock()
		why := "."
		if a.err != nil {
			why = ": " + a.err.Error()
		}
		return nil, failed("The sim runs an .apl.siml rotation in a WoWSims repository%s", why)
	}
	for _, diag := range a.doc.Diagnostics() {
		if diag.Severity == siml.Error {
			s.mu.Unlock()
			return nil, failed("The rotation does not read (line %d: %s); fix it before simming it.", diag.Start.Line, diag.Message)
		}
	}
	for _, used := range a.used {
		if open := s.docByPathLocked(used); open != nil && unsaved(open.path, open.text) {
			s.mu.Unlock()
			return nil, failed("%s has unsaved changes; the sim reads it from disk. Save it first.", filepath.Base(used))
		}
	}
	text, path, root := d.text, d.path, a.root
	s.mu.Unlock()

	file, err := filepath.Rel(root, path)
	if err != nil {
		file = path
	}
	file = filepath.ToSlash(file)
	req := simRequest{
		SIML:         text,
		Path:         file,
		SettingsFile: p.settingsFile,
		Iterations:   p.iterations,
		Seed:         p.seed,
		Timeline:     p.timeline,
	}
	if req.Iterations <= 0 {
		req.Iterations = defaultIterations
	}
	req.Iterations = min(req.Iterations, maxIterations)
	var baseline string
	if p.compare {
		var base []byte
		if unsaved(path, text) {
			baseline = "saved"
			base, err = os.ReadFile(path)
		} else {
			baseline = "HEAD"
			cmd := exec.CommandContext(ctx, "git", "show", "HEAD:"+file)
			cmd.Dir = root
			base, err = cmd.Output()
		}
		if err != nil {
			return nil, failed("Nothing to compare with: %s", strings.SplitN(err.Error(), "\n", 2)[0])
		}
		req.SIML, req.Compare = string(base), &struct {
			SIML string `json:"siml"`
		}{text}
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, failed("%s", err.Error())
	}
	raw, err := s.opts.Sim(ctx, root, body)
	if ctx.Err() != nil {
		return nil, &ResponseError{Code: codeRequestCancelled, Message: "the sim was cancelled"}
	}
	if err != nil {
		return nil, failed("Sim failed: %s", err.Error())
	}
	return simResult(raw, baseline)
}

// Whether an open document's text differs from its file's.
func unsaved(path, text string) bool {
	disk, err := os.ReadFile(path)
	return err != nil || !bytes.Equal(disk, []byte(text))
}

// The result as `wowsimcli siml sim` writes it, with baseline (saved or HEAD) and the difference added to a
// compare's; an error when the sim did not run.
func simResult(raw json.RawMessage, baseline string) (any, *ResponseError) {
	var result map[string]json.RawMessage
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, failed("wowsimcli siml sim gave no result: %s", err.Error())
	}
	if message, ok := result["error"]; ok {
		var text string
		_ = json.Unmarshal(message, &text)
		if text != "" {
			return nil, failed("%s", text)
		}
	}
	if result["dps"] == nil || result["rows"] == nil || result["character"] == nil {
		return nil, failed("wowsimcli siml sim gave an incomplete result")
	}
	if compare := result["compare"]; compare != nil {
		var base, other simRun
		if err := json.Unmarshal(raw, &base); err != nil {
			return nil, failed("%s", err.Error())
		}
		if err := json.Unmarshal(compare, &other); err != nil {
			return nil, failed("%s", err.Error())
		}
		encoded, err := json.Marshal(difference(base, other))
		if err != nil {
			return nil, failed("%s", err.Error())
		}
		result["difference"] = encoded
	}
	if baseline != "" {
		result["baseline"] = json.RawMessage(fmt.Sprintf("%q", baseline))
	}
	return result, nil
}
