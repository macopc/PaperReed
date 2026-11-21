//go:build darwin || linux

package main

import (
	"os"
	"syscall"
	"unsafe"
)

func terminal(f *os.File) bool {
	var state syscall.Termios
	_, _, err := syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), termiosRequest, uintptr(unsafe.Pointer(&state)))
	return err == 0
}
