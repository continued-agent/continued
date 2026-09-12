import { describe, expect, it } from "vitest";

import { buildCspMetaContent, resolveMcpAppToolPolicy } from "./MCPAppRenderer";

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

describe("buildCspMetaContent", () => {
  it("rejects private-network and non-web ports", () => {
    const csp = buildCspMetaContent({
      resourceDomains: [
        "http://127.0.0.1/",
        "http://169.254.169.254/",
        "https://public.example/",
      ],
      connectDomains: [
        "https://public.example/",
        "https://public.example:5432/",
      ],
    });

    expect(csp).toContain("https://public.example");
    expect(csp).not.toContain("127.0.0.1");
    expect(csp).not.toContain("169.254.169.254");
    expect(csp).not.toContain(":5432");
  });
});
