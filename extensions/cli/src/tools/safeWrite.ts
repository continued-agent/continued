import * as fs from "fs";

import { ContinueError, ContinueErrorReason } from "core/util/errors.js";

/**
 * Write file content without following symlinks and only if the file still
 * matches the expected previous content. This closes the TOCTOU window in
 * Edit/MultiEdit: between the preview (which resolved the path and read the
 * old content) and the write, a local process could replace the path with a
 * symlink pointing outside the workspace. Opening with O_NOFOLLOW refuses to
 * follow a symlink, and verifying the current content before overwriting
 * ensures we never clobber a file that changed underneath us.
 *
 * Windows does not support O_NOFOLLOW, but the canonical-path checks in
 * resolvePathInWorkspace still apply.
 */
export function writeFileNoFollow(
  filePath: string,
  newContent: string,
  expectedOldContent: string,
): void {
  const noFollow = process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW;

  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDWR | noFollow);

    // Verify the file still contains what the preview was based on. A symlink
    // swap would either fail the open above (ELOOP) or point at a different
    // inode whose content differs from what we read.
    let currentContent = "";
    try {
      currentContent = fs.readFileSync(fd, "utf-8");
    } catch {
      // File may be empty or unreadable; treat as mismatch below.
    }
    if (currentContent !== expectedOldContent) {
      throw new ContinueError(
        ContinueErrorReason.FileWriteError,
        `File ${filePath} changed since it was read. Refusing to overwrite. Re-read the file and try again.`,
      );
    }

    fs.ftruncateSync(fd, 0);
    if (newContent.length > 0) {
      fs.writeSync(fd, newContent, 0, "utf-8");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new ContinueError(
        ContinueErrorReason.FileIsSecurityConcern,
        `Refusing to follow symlink while editing ${filePath}`,
      );
    }
    throw error;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}
