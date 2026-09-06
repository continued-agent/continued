import { describe, expect, it } from "vitest";

import { resolveMcpAppToolPolicy } from "./MCPAppRenderer";

describe("resolveMcpAppToolPolicy", () => {
  const targetTool = {
    function: { name: "server__target" },
    defaultToolPolicy: "allowedWithoutPermission",
  } as any;

  it("uses the policy of the tool requested by the MCP app", () => {
    expect(
      resolveMcpAppToolPolicy(
        "server__target",
        {
          server__target: "disabled",
          server__renderer: "allowedWithoutPermission",
        },
        [targetTool],
      ),
    ).toBe("disabled");
  });

  it("does not inherit auto-approval from the UI-rendering tool", () => {
    expect(
      resolveMcpAppToolPolicy(
        "server__unknown",
        { server__renderer: "allowedWithoutPermission" },
        [targetTool],
      ),
    ).toBe("allowedWithPermission");
  });
});
