import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ensurePrivateDirectory } from "./filePermissions.js";

describe("ensurePrivateDirectory", () => {
  it("restricts existing and newly-created directories on Unix", () => {
    if (process.platform === "win32") {
      return;
    }

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "continue-permissions-"),
    );
    const directory = path.join(root, "nested");

    try {
      ensurePrivateDirectory(directory);
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700);

      fs.chmodSync(directory, 0o755);
      ensurePrivateDirectory(directory);
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
