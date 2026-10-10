package siml

import "sync"

// A value made on first use. A package-level sync.OnceValues keeps the function it wraps, and all that function
// calls, in every binary that imports the package, since the package's init refers to it; a lazy read only inside a
// function is kept only where that function is reachable. lib.wasm imports this package through sim/core's preset
// loaders, which it never calls, so it carries no schema code.
type lazy[T any] struct {
	once  sync.Once
	value T
	err   error
}

func (l *lazy[T]) get(make func() (T, error)) (T, error) {
	l.once.Do(func() { l.value, l.err = make() })
	return l.value, l.err
}
