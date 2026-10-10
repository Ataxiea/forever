package lsp

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wowsims/forever/sim/siml"
)

// The name table every check reads, from the repository the file sits in (`make sim/siml/names.json`), read again
// whenever it changes on disk; the schema is the one the server is built with.
var tableFile = filepath.Join("sim", "siml", "names.json")

// The repository root above a file: the first folder up that holds the name table.
func repositoryRoot(file string) (string, bool) {
	for dir := filepath.Dir(file); ; dir = filepath.Dir(dir) {
		if isFile(filepath.Join(dir, tableFile)) {
			return dir, true
		}
		if filepath.Dir(dir) == dir {
			return "", false
		}
	}
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// A file's size and time, which say it changed.
type stamp struct {
	size int64
	time time.Time
}

func stampOf(path string) stamp {
	info, err := os.Stat(path)
	if err != nil {
		return stamp{size: -1}
	}
	return stamp{info.Size(), info.ModTime()}
}

// A repository's name table, or why it does not read.
type table struct {
	stamp stamp
	names *siml.Names
	err   error
}

type workspaces struct {
	mu     sync.Mutex
	tables map[string]*table
	dbs    map[string]*database
}

func newWorkspaces() *workspaces {
	return &workspaces{tables: map[string]*table{}, dbs: map[string]*database{}}
}

// The name table of the repository at root, read again when the file changed since the last read.
func (w *workspaces) names(root string) (*siml.Names, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	path := filepath.Join(root, tableFile)
	now := stampOf(path)
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

// The panel's names and icons of the repository at root, read on first use and again when either database file
// changes.
func (w *workspaces) database(root string) *database {
	w.mu.Lock()
	defer w.mu.Unlock()
	now := databaseStamp(root)
	if db := w.dbs[root]; db != nil && db.stamp == now {
		return db
	}
	db := &database{root: root, stamp: now}
	w.dbs[root] = db
	return db
}

// The path of a file: URI; false for any other scheme.
func uriPath(uri string) (string, bool) {
	u, err := url.Parse(uri)
	if err != nil || u.Scheme != "file" {
		return "", false
	}
	path := u.Path
	if runtime.GOOS == "windows" {
		path = strings.TrimPrefix(path, "/")
	}
	if u.Host != "" && u.Host != "localhost" {
		path = "//" + u.Host + path
	}
	return filepath.FromSlash(path), true
}

// The file: URI of a path, as editors write it.
func pathURI(path string) string {
	slashed := filepath.ToSlash(path)
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
