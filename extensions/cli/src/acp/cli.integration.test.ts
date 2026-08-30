import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import * as acp from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it } from "vitest";

const cliDirectory = fileURLToPath(new URL("../..", import.meta.url));
const children: ReturnType<typeof spawn>[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) =>
        child.once("close", () => resolve()),
      );
    }
  }
});

describe("ACP CLI transport", () => {
  it("communicates with cn acp using the official SDK and keeps stdout NDJSON-only", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "continue-acp-"));
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--eval",
        "import('./src/index.ts').then(({ runCli }) => runCli())",
        "acp",
        "--config",
        join(cliDirectory, "test-fixtures/model-switch-test-config.yaml"),
      ],
      {
        cwd: cliDirectory,
        env: {
          ...process.env,
          CONTINUE_GLOBAL_DIR: workspace,
          CONTINUE_CLI_DISABLE_COMMIT_SIGNATURE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    children.push(child);

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    );
    const result = await acp
      .client({ name: "vitest-client" })
      .connectWith(stream, async (ctx) => {
        const initialized = await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        const session = await ctx.request(acp.methods.agent.session.new, {
          cwd: workspace,
          mcpServers: [],
        });
        return { initialized, session };
      });

    expect(result.initialized.protocolVersion).toBe(acp.PROTOCOL_VERSION);
    expect(result.initialized.agentInfo?.name).toBe("continue");
    expect(result.session.sessionId).toEqual(expect.any(String));
    expect(stderr).not.toMatch(/stdout|console\.log/);

    await rm(workspace, { recursive: true, force: true });
  }, 30000);
});
