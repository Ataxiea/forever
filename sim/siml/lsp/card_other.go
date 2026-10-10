//go:build !unix

package lsp

import "os/exec"

// Outside unix a cancel kills go alone; WaitDelay ends the wait on the program it builds.
func ownGroup(cmd *exec.Cmd) {}
