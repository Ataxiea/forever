package lsp

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/wowsims/forever/sim/siml"
)

// The name table every check reads, from the repository the file sits in (`make siml-names`), read again
// whenever it changes on disk; the schema is the one the server is built with.
var tableFile = filepath.Join("sim", "siml", "names.json")

// A repository's name table, or why it does not read.
type table struct {
	stamp siml.FileStamp
	names *siml.Names
	err   error
}

type workspaces struct {
	mu     sync.Mutex
	tables map[string]*table
}

func newWorkspaces() *workspaces {
	return &workspaces{tables: map[string]*table{}}
}

// The name table of the repository at root, read again when the file changed since the last read.
func (w *workspaces) names(root string) (*siml.Names, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	path := filepath.Join(root, tableFile)
	now := siml.StampOf(path)
	if t := w.tables[root]; t != nil && t.stamp == now {
		return t.names, t.err
	}
	t := &table{stamp: now}
	if data, err := os.ReadFile(path); err != nil {
		t.err = fmt.Errorf("the name table does not read: %w", err)
	} else if t.names, err = siml.ParseNames(data); err != nil {
		t.err = fmt.Errorf("%s: %w", filepath.ToSlash(tableFile), err)
	}
	w.tables[root] = t
	return t.names, t.err
}

// The path of a file: URI; false for any other scheme.
func uriPath(uri string) (string, bool) {
	u, err := url.Parse(uri)
	if err != nil || u.Scheme != "file" {
		return "", false
	}
	path := u.Path
	if u.Host != "" && u.Host != "localhost" {
		path = "//" + u.Host + path
	} else if runtime.GOOS == "windows" {
		path = strings.TrimPrefix(path, "/")
	}
	return filepath.FromSlash(path), true
}

// The file: URI of a path, as editors write it.
func pathURI(path string) string {
	slashed := filepath.ToSlash(path)
	if host, rest, unc := strings.Cut(strings.TrimPrefix(slashed, "//"), "/"); unc && strings.HasPrefix(slashed, "//") {
		return (&url.URL{Scheme: "file", Host: host, Path: "/" + rest}).String()
	}
	if !strings.HasPrefix(slashed, "/") {
		slashed = "/" + slashed
	}
	return (&url.URL{Scheme: "file", Path: slashed}).String()
}

// Whether two paths name one file.
func samePath(a, b string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
	}
	return filepath.Clean(a) == filepath.Clean(b)
}
