import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { logger } from "./logger.js";

describe("logger file permissions", () => {
  it("keeps the log directory and file private on Unix", () => {
    if (process.platform === "win32") {
      return;
    }

    const logFilePath = logger.getLogPath();
    const logDirectoryPath = path.dirname(logFilePath);

    expect(fs.statSync(logDirectoryPath).mode & 0o777).toBe(0o700);
    expect(fs.statSync(logFilePath).mode & 0o777).toBe(0o600);
  });
});
