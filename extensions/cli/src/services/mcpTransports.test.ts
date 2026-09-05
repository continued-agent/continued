import { afterEach, describe, expect, it } from "vitest";

import { buildMcpEnvironment } from "./mcpTransports.js";

describe("MCP stdio environment", () => {
  const originalPath = process.env.PATH;
  const originalApiKey = process.env.CONTINUE_TEST_SECRET;

  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalApiKey === undefined) delete process.env.CONTINUE_TEST_SECRET;
    else process.env.CONTINUE_TEST_SECRET = originalApiKey;
  });

  it("inherits only the process variables required to launch a child", () => {
    process.env.PATH = "/safe/path";
    process.env.CONTINUE_TEST_SECRET = "must-not-leak";

    expect(buildMcpEnvironment()).toMatchObject({ PATH: "/safe/path" });
    expect(buildMcpEnvironment()).not.toHaveProperty("CONTINUE_TEST_SECRET");
  });

  it("allows a server configuration to provide explicit variables", () => {
    process.env.CONTINUE_TEST_SECRET = "process-secret";

    expect(
      buildMcpEnvironment({
        CONTINUE_TEST_SECRET: "configured-value",
        MCP_MODE: "test",
      }),
    ).toMatchObject({
      CONTINUE_TEST_SECRET: "configured-value",
      MCP_MODE: "test",
    });
  });
});
