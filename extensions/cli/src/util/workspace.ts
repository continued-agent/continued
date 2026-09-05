import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

import { ContinueError, ContinueErrorReason } from "core/util/errors.js";

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

function isWithinDirectory(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * Resolve a tool path and ensure that its canonical target stays within the
 * current workspace. The nearest existing ancestor is resolved so symlinks in
 * parent directories and symlinked existing files cannot escape the boundary.
 */
export function resolvePathInWorkspace(inputPath: string): string {
  const workspace = getWorkspaceDirectory();
  const absolutePath = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(workspace, inputPath);

  let existingPath = absolutePath;
  const missingSegments: string[] = [];
  while (true) {
    try {
      // lstat also finds broken symlinks, which must not be followed for a
      // write operation outside the workspace.
      fs.lstatSync(existingPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new ContinueError(
          ContinueErrorReason.PathResolutionFailed,
          `Unable to resolve path: ${inputPath}`,
        );
      }

      const parent = path.dirname(existingPath);
      if (parent === existingPath) {
        throw new ContinueError(
          ContinueErrorReason.PathResolutionFailed,
          `Unable to resolve path: ${inputPath}`,
        );
      }
      missingSegments.unshift(path.basename(existingPath));
      existingPath = parent;
    }
  }

  let canonicalWorkspace: string;
  let canonicalExistingPath: string;
  try {
    canonicalWorkspace = fs.realpathSync(workspace);
    canonicalExistingPath = fs.realpathSync(existingPath);
  } catch {
    throw new ContinueError(
      ContinueErrorReason.PathResolutionFailed,
      `Unable to resolve path: ${inputPath}`,
    );
  }

  const canonicalPath = path.join(canonicalExistingPath, ...missingSegments);
  if (!isWithinDirectory(canonicalWorkspace, canonicalPath)) {
    throw new ContinueError(
      ContinueErrorReason.FileIsSecurityConcern,
      `Path is outside the current workspace: ${inputPath}`,
    );
  }

  return canonicalPath;
}
