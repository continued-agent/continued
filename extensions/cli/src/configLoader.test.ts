import { homedir } from "node:os";

import { describe, expect, it } from "vitest";

import { expandConfigPath } from "./configLoader.js";

describe("expandConfigPath", () => {
  it("expands a home-relative config path", () => {
    expect(expandConfigPath("~/config.yaml")).toBe(`${homedir()}/config.yaml`);
  });

  it("leaves absolute and assistant-slug paths unchanged", () => {
    expect(expandConfigPath("/tmp/config.yaml")).toBe("/tmp/config.yaml");
    expect(expandConfigPath("owner/assistant")).toBe("owner/assistant");
  });
});
