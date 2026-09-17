import { describe, expect, it, vi } from "vitest";

vi.mock("./util/cli.js", () => ({
  isAcpMode: () => true,
}));

import { compareVersions, parseLatestVersionResponse } from "./version.js";

describe("version response handling", () => {
  it("accepts a semantic version response", () => {
    expect(parseLatestVersionResponse({ version: "1.2.3" })).toBe("1.2.3");
  });

  it("rejects malformed version responses before comparison", () => {
    expect(() => parseLatestVersionResponse({ version: 42 })).toThrow(
      "Invalid version response",
    );
    expect(compareVersions("1.0.0", 42 as never)).toBe("same");
  });
});
