package siml

import (
	"os"
	"time"
)

// A file's size and modification time, which say it changed since a read. A missing file's size is -1.
type FileStamp struct {
	Size int64
	Time time.Time
}

func StampOf(path string) FileStamp {
	info, err := os.Stat(path)
	if err != nil {
		return FileStamp{Size: -1}
	}
	return FileStamp{info.Size(), info.ModTime()}
}
