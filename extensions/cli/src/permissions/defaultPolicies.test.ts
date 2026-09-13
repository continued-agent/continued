import { describe, expect, it } from "vitest";

import {
  getDefaultToolPolicies,
  REVIEW_MODE_POLICIES,
} from "./defaultPolicies.js";
import { checkToolPermission } from "./permissionChecker.js";
const DEFAULT_TOOL_POLICIES = getDefaultToolPolicies();

describe("defaultPolicies", () => {
  it("should have correct permissions for read-only tools", () => {
    const readOnlyTools = [
      "Read",
      "List",
      "Search",
      "Fetch",
      "Exit",
      "Diff",
      "Checklist",
    ];

    for (const tool of readOnlyTools) {
      const policy = DEFAULT_TOOL_POLICIES.find((p) => p.tool === tool);
      expect(policy, `Policy should exist for ${tool}`).toBeDefined();
      expect(policy?.permission, `${tool} should be allowed`).toBe("allow");
    }
  });

  it("should not have prefix wildcard policies in defaults", () => {
    const prefixWildcardPolicy = DEFAULT_TOOL_POLICIES.find(
      (p) => p.tool.endsWith("*") && p.tool !== "*",
    );
    expect(prefixWildcardPolicy).toBeUndefined();
  });

  it("should have correct permissions for write tools", () => {
    const writeTools = ["Write", "Edit", "MultiEdit", "Bash"];

    for (const tool of writeTools) {
      const policy = DEFAULT_TOOL_POLICIES.find((p) => p.tool === tool);
      expect(policy, `Policy should exist for ${tool}`).toBeDefined();
      expect(policy?.permission, `${tool} should require confirmation`).toBe(
        "ask",
      );
    }
  });

  it("should have a catch-all policy", () => {
    const catchAllPolicy = DEFAULT_TOOL_POLICIES.find((p) => p.tool === "*");
    expect(catchAllPolicy).toBeDefined();
    expect(catchAllPolicy?.permission).toBe("ask");
  });

  it("should not auto-approve Bash or unknown tools in headless mode", () => {
    // Headless mode has no interactive approver, so `ask` tools are excluded.
    // Bash and unknown (MCP/external) tools must therefore remain `ask` and
    // require an explicit --allow/--auto opt-in.
    const permissions = { policies: DEFAULT_TOOL_POLICIES };

    expect(
      checkToolPermission({ name: "Bash", arguments: {} }, permissions)
        .permission,
    ).toBe("ask");
    expect(
      checkToolPermission({ name: "unknown_tool", arguments: {} }, permissions)
        .permission,
    ).toBe("ask");
    expect(
      checkToolPermission(
        { name: "mcp__server__tool", arguments: {} },
        permissions,
      ).permission,
    ).toBe("ask");
  });

  it("should include MultiEdit policy", () => {
    const multiEditPolicy = DEFAULT_TOOL_POLICIES.find(
      (p) => p.tool === "MultiEdit",
    );
    expect(multiEditPolicy).toBeDefined();
    expect(multiEditPolicy?.permission).toBe("ask");
  });

  it("should have policies in correct order", () => {
    // The catch-all policy should be last
    const catchAllIndex = DEFAULT_TOOL_POLICIES.findIndex(
      (p) => p.tool === "*",
    );
    expect(catchAllIndex).toBe(DEFAULT_TOOL_POLICIES.length - 1);
  });

  it("should exclude command execution and external tools in review mode", () => {
    expect(REVIEW_MODE_POLICIES).toContainEqual({
      tool: "Read",
      permission: "allow",
    });
    expect(
      checkToolPermission(
        { name: "Bash", arguments: {} },
        { policies: REVIEW_MODE_POLICIES },
      ).permission,
    ).toBe("exclude");
    expect(REVIEW_MODE_POLICIES).not.toContainEqual({
      tool: "Status",
      permission: "allow",
    });
    expect(REVIEW_MODE_POLICIES).not.toContainEqual({
      tool: "CheckBackgroundJob",
      permission: "allow",
    });
    expect(REVIEW_MODE_POLICIES.at(-1)).toEqual({
      tool: "*",
      permission: "exclude",
    });
  });
});
