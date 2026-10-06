//go:build !windows

package agent

import (
	"errors"
	"log/slog"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// hideAgentWindow is a no-op on non-Windows platforms.
func hideAgentWindow(cmd *exec.Cmd) {}

// configureProcessGroup puts the child into its own process group (it becomes
// the group leader, so the group id equals the child pid). This lets the
// daemon signal the entire tree — the agent CLI plus any tool subprocess it
// spawns — in one call, instead of killing only the direct child and leaking
// grandchildren that keep running (and, for opencode, spinning on EPIPE) after
// a task is cancelled or the daemon restarts. See signalProcessGroup.
//
// Called by newRuntimeCmd in launch.go, which is the single point where a
// runtime process is constructed. No backend calls it directly: the group has
// to exist for every runtime process, and per-backend opt-in did not deliver
// that (GH #7522).
func configureProcessGroup(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

// startOwnedProcessTree is a plain Start on non-Windows platforms:
// newRuntimeCmd already put the child in its own process group before it
// existed, so there is nothing left to claim once it is running. The logger is
// unused here; Windows needs it to report degraded ownership.
//
// It is still the only way this package starts a long-lived runtime process,
// so the two platforms share one call site per backend.
func startOwnedProcessTree(cmd *exec.Cmd, _ *slog.Logger) error { return cmd.Start() }

// releaseProcessGroup is a no-op on non-Windows platforms: a process group needs
// no handle and is gone once its members are.
func releaseProcessGroup(cmd *exec.Cmd) {}

func codexInitializeRetrySupported() bool { return true }

// signalProcessGroup sends sig to the whole process group led by the command
// (when it was started with configureProcessGroup), falling back to the single
// process if the group send fails. Targeting the group (negative pid) reaches
// the descendants the agent spawned, not just the leader.
func signalProcessGroup(cmd *exec.Cmd, sig syscall.Signal) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	// Some tools (OpenCode's shell runner among them) put their own commands in
	// a new session/process group. Those descendants escape a negative-PID group
	// signal and used to survive a cancelled run as orphans. Snapshot descendants
	// while the runtime leader still exists, signal deepest children first, then
	// signal its process group as usual.
	for _, pid := range processDescendants(cmd.Process.Pid) {
		_ = syscall.Kill(pid, sig)
	}
	if err := syscall.Kill(-cmd.Process.Pid, sig); err != nil {
		_ = cmd.Process.Signal(sig)
	}
}

func processDescendants(rootPID int) []int {
	out, err := exec.Command("ps", "-axo", "pid=,ppid=").Output()
	if err != nil {
		return nil
	}
	children := make(map[int][]int)
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		pid, pidErr := strconv.Atoi(fields[0])
		parent, parentErr := strconv.Atoi(fields[1])
		if pidErr == nil && parentErr == nil && pid > 1 && parent > 1 {
			children[parent] = append(children[parent], pid)
		}
	}
	var descendants []int
	queue := []int{rootPID}
	for len(queue) > 0 {
		parent := queue[0]
		queue = queue[1:]
		queue = append(queue, children[parent]...)
		descendants = append(descendants, children[parent]...)
	}
	for left, right := 0, len(descendants)-1; left < right; left, right = left+1, right-1 {
		descendants[left], descendants[right] = descendants[right], descendants[left]
	}
	return descendants
}

func waitProcessGroupGone(cmd *exec.Cmd, timeout time.Duration) bool {
	if cmd == nil || cmd.Process == nil {
		return false
	}
	deadline := time.Now().Add(timeout)
	for {
		err := syscall.Kill(-cmd.Process.Pid, 0)
		if errors.Is(err, syscall.ESRCH) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(10 * time.Millisecond)
	}
}
