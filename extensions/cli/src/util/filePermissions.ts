import fs from "fs";

/**
 * Create a user-owned directory and remove group/other permissions on Unix.
 * Windows does not use POSIX mode bits for access control, so creation is
 * still recursive but chmod is intentionally skipped there.
 */
export function ensurePrivateDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { mode: 0o700, recursive: true });

  if (process.platform !== "win32") {
    fs.chmodSync(directoryPath, 0o700);
  }
}
