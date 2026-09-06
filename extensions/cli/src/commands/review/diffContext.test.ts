import { execFileSync } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeDiffContext } from "./diffContext.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../../util/logger.js", () => ({
  logger: { warn: vi.fn() },
}));

describe("computeDiffContext", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockImplementation((_file, args) => {
      const argumentsList = args as string[];
      if (argumentsList[0] === "merge-base") return "merge-base-sha\n";
      if (argumentsList.includes("--name-only")) return "changed.ts\n";
      if (argumentsList.includes("--stat")) return "changed.ts | 1 +\n";
      return "diff output";
    });
  });

  it("passes user-supplied refs as argument values, never shell source", () => {
    const base = "feature; touch /tmp/should-not-exist";
    const result = computeDiffContext(base);

    expect(result.diff).toBe("diff output");
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["merge-base", "--end-of-options", base, "HEAD"],
      expect.objectContaining({ encoding: "utf-8" }),
    );
    expect(execFileSync).not.toHaveBeenCalledWith(
      "git merge-base feature; touch /tmp/should-not-exist HEAD",
      expect.anything(),
    );
  });
});
