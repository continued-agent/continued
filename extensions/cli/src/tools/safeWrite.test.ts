import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { afterEach, describe, expect, it } from "vitest";

import { writeFileNoFollow } from "./safeWrite.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createTemporaryFile(initialContent: string) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "continue-safe-write-"),
  );
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "file.txt");
  fs.writeFileSync(filePath, initialContent, "utf8");
  return { directory, filePath };
}

describe("writeFileNoFollow", () => {
  it("updates a file after verifying its current content", () => {
    const { filePath } = createTemporaryFile("before content");

    writeFileNoFollow(filePath, "after", "before content");

    expect(fs.readFileSync(filePath, "utf8")).toBe("after");
  });

  it("does not truncate a file when the expected content is stale", () => {
    const { filePath } = createTemporaryFile("original content");

    expect(() =>
      writeFileNoFollow(filePath, "replacement", "stale content"),
    ).toThrow(ContinueError);
    expect(fs.readFileSync(filePath, "utf8")).toBe("original content");
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinks without modifying their target",
    () => {
      const { directory, filePath } = createTemporaryFile("target content");
      const symlinkPath = path.join(directory, "link.txt");
      fs.symlinkSync(filePath, symlinkPath);

      expect(() =>
        writeFileNoFollow(symlinkPath, "replacement", "target content"),
      ).toThrow(ContinueError);
      expect(() =>
        writeFileNoFollow(symlinkPath, "replacement", "target content"),
      ).toThrow(
        expect.objectContaining({
          reason: ContinueErrorReason.FileIsSecurityConcern,
        }),
      );
      expect(fs.readFileSync(filePath, "utf8")).toBe("target content");
    },
  );
});
