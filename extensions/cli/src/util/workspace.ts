import { AsyncLocalStorage } from "node:async_hooks";

const workspaceStorage = new AsyncLocalStorage<string>();

/**
 * Returns the workspace associated with the current operation.
 *
 * Normal CLI commands retain their existing process.cwd() behavior. ACP turns
 * run inside an async workspace context so multiple sessions do not require
 * changing the process-wide working directory.
 */
export function getWorkspaceDirectory(): string {
  return workspaceStorage.getStore() ?? process.cwd();
}

export function runWithWorkspace<T>(
  workspaceDirectory: string,
  operation: () => T,
): T {
  return workspaceStorage.run(workspaceDirectory, operation);
}
