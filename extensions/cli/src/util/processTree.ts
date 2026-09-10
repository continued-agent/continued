import { ChildProcess } from "child_process";

/**
 * Kill a child process and its entire descendant tree.
 *
 * On POSIX, spawn the child in its own process group (detached) and signal the
 * group, escalating from SIGTERM to SIGKILL. On Windows, use taskkill /T so
 * the whole tree is terminated. Without this, only the shell parent dies and
 * servers/workers it spawned keep running after a timeout or cancellation.
 */
export function killProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    try {
      const { spawnSync } =
        require("child_process") as typeof import("child_process");
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      child.kill();
    }
    return;
  }

  // POSIX: signal the process group. The child must have been spawned with
  // `detached: true` so it leads its own group; otherwise this would signal
  // our own group.
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Process group may already be gone; fall back to signaling the child.
    try {
      child.kill(signal);
    } catch {
      // Already dead.
    }
  }
}

/**
 * Escalate from SIGTERM to SIGKILL after a grace period so stubborn children
 * cannot outlive the timeout indefinitely.
 */
export function killProcessTreeWithEscalation(
  child: ChildProcess,
  graceMs = 2000,
): void {
  killProcessTree(child, "SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      killProcessTree(child, "SIGKILL");
    }
  }, graceMs).unref();
}
