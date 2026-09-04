import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ContinueError } from "core/util/errors.js";
import { afterEach, describe, expect, it } from "vitest";

import { resolvePathInWorkspace, runWithWorkspace } from "./workspace.js";

const temporaryDirectories: string[] = [];

function createWorkspace(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "continue-workspace-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("resolvePathInWorkspace", () => {
  it("resolves relative and new paths inside the workspace", () => {
    const workspace = createWorkspace();

    const resolved = runWithWorkspace(workspace, () =>
      resolvePathInWorkspace("src/new-file.ts"),
    );

    expect(resolved).toBe(path.join(workspace, "src/new-file.ts"));
  });

  it("rejects absolute paths outside the workspace", () => {
    const workspace = createWorkspace();
    const outside = path.join(os.tmpdir(), "outside-file.txt");

    expect(() =>
      runWithWorkspace(workspace, () => resolvePathInWorkspace(outside)),
    ).toThrow(ContinueError);
  });

  it("rejects symlinks that resolve outside the workspace", () => {
    const workspace = createWorkspace();
    const outside = createWorkspace();
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(outside, path.join(workspace, "linked-directory"));

    expect(() =>
      runWithWorkspace(workspace, () =>
        resolvePathInWorkspace("linked-directory/secret.txt"),
      ),
    ).toThrow(ContinueError);
  });

  it("allows symlinks whose canonical target stays in the workspace", () => {
    const workspace = createWorkspace();
    fs.mkdirSync(path.join(workspace, "real"));
    fs.writeFileSync(path.join(workspace, "real", "file.txt"), "content");
    fs.symlinkSync(
      path.join(workspace, "real"),
      path.join(workspace, "linked-directory"),
    );

    const resolved = runWithWorkspace(workspace, () =>
      resolvePathInWorkspace("linked-directory/file.txt"),
    );

    expect(resolved).toBe(path.join(workspace, "real/file.txt"));
  });
});
