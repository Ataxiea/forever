//go:build unix

package lsp

import (
	"os/exec"
	"syscall"
)

// Runs cmd in a process group of its own, which a cancel kills whole: `go run` leaves the program it builds running
// when only go is killed.
func ownGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
}
