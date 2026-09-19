import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRemoteOptions,
  isLoopbackAddress,
  parseRemotePort,
  validateNoTuiInvocation,
} from "./options.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("remote CLI options", () => {
  it("accepts port zero and uses the documented default", () => {
    expect(parseRemotePort(undefined)).toBe(4173);
    expect(parseRemotePort(0)).toBe(0);
    expect(parseRemotePort("0")).toBe(0);
    expect(() => parseRemotePort("65536")).toThrow();
  });

  it("rejects no-TUI combinations that could accidentally run another mode", () => {
    expect(
      validateNoTuiInvocation({
        prompt: "run this once",
        options: { noTui: true },
      }),
    ).toContain("Error: --no-tui cannot be combined with a positional prompt");
    expect(
      validateNoTuiInvocation({
        options: { noTui: true, resume: true },
      }),
    ).toContain("Error: use --session instead of --resume with --no-tui");
  });

  it("requires authentication before allowing a non-loopback bind", async () => {
    await expect(
      createRemoteOptions({ host: "0.0.0.0", workspace: process.cwd() }),
    ).rejects.toThrow(/without --auth-token/);
    const options = await createRemoteOptions({
      host: "0.0.0.0",
      authToken: "test-token",
      workspace: process.cwd(),
    });
    expect(options.host).toBe("0.0.0.0");
  });

  it("resolves the workspace and rejects files and non-directories", async () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "continue-remote-options-"),
    );
    temporaryDirectories.push(directory);
    mkdirSync(path.join(directory, "nested"));
    const options = await createRemoteOptions({
      workspace: path.join(directory, "nested"),
    });
    expect(options.workspace).toBe(path.join(directory, "nested"));
  });

  it("recognizes loopback aliases and ranges", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.44.1.2")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.1")).toBe(false);
  });
});
