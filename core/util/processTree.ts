import childProcess, { ChildProcess } from "node:child_process";

/**
 * Signal a process and its descendants.
 *
 * POSIX commands are spawned in their own process group by the callers. Windows
 * uses taskkill so descendants are included there as well.
 */
export function killProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  if (!child.pid) {
    child.kill(signal);
    return;
  }

  if (process.platform === "win32") {
    try {
      childProcess.spawnSync(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        {
          stdio: "ignore",
        },
      );
    } catch {
      child.kill(signal);
    }
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process has already exited.
    }
  }
}
