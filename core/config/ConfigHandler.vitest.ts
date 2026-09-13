import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, test } from "vitest";
import { testConfigHandler, testIde } from "../test/fixtures";
import { TEST_DIR, TEST_DIR_PATH, setUpTestDir } from "../test/testDir";
import { getConfigTsPath } from "../util/paths";

import { defaultConfig } from "./default";

describe("Test the ConfigHandler and E2E config loading", () => {
  beforeEach(() => {
    setUpTestDir();
  });

  test("should show only local profile", () => {
    const currentProfile = testConfigHandler.currentProfile;
    expect(currentProfile?.profileDescription.id).toBe("local");
  });

  test("should load the default config successfully", async () => {
    const result = await testConfigHandler.loadConfig();
    expect(result.config!.modelsByRole.chat.length).toBe(
      defaultConfig.models?.length,
    );
  });

  test("should add a system message from config.ts", async () => {
    const configTs = `export function modifyConfig(config: Config): Config {
    config.systemMessage = "SYSTEM";
    return config;
}`;
    fs.writeFileSync(getConfigTsPath(), configTs);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = await testConfigHandler.reloadConfig("test");
    // config.ts can set systemMessage; it should surface as a rule.
    const rules = (result as any).config?.rules ?? [];
    expect(rules.some((r: any) => r.rule === "SYSTEM")).toBe(true);
  });

  test("should acknowledge override from .continuerc.json in the JSON config path", async () => {
    // The workspace `.continuerc.json` override is applied by the JSON config
    // loader. The default profile uses the YAML loader, so write the override
    // and verify the loader reads workspace rc files (the merge itself is
    // exercised in config/json/loadRcConfigs tests).
    const rcPath = path.join(TEST_DIR_PATH, ".continuerc.json");
    fs.writeFileSync(rcPath, JSON.stringify({ systemMessage: "SYSTEM2" }));
    const { getWorkspaceRcConfigs } = await import("./json/loadRcConfigs.js");
    const rcConfigs = await getWorkspaceRcConfigs(testIde);
    expect(rcConfigs.some((rc) => rc.config.systemMessage === "SYSTEM2")).toBe(
      true,
    );
    // The workspace source must be preserved so workspace MCP servers can be
    // held for approval.
    expect(
      rcConfigs.some((rc) => rc.sourceFile.endsWith(".continuerc.json")),
    ).toBe(true);
  });

  test("tags workspace .continuerc.json MCP servers with their source file", async () => {
    fs.writeFileSync(
      path.join(TEST_DIR_PATH, ".continuerc.json"),
      JSON.stringify({
        experimental: {
          modelContextProtocolServers: [
            {
              transport: {
                type: "stdio",
                command: "echo",
                args: ["hello"],
              },
            },
          ],
        },
      }),
    );
    const { getWorkspaceRcConfigs } = await import("./json/loadRcConfigs.js");
    const rcConfigs = await getWorkspaceRcConfigs(testIde);
    const server = rcConfigs[0]?.config.experimental
      ?.modelContextProtocolServers?.[0] as { sourceFile?: string } | undefined;
    expect(server?.sourceFile?.endsWith(".continuerc.json")).toBe(true);
  });
});
