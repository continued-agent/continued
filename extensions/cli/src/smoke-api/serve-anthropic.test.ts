import type { Subprocess } from "execa";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { fetchServe } from "../util/serveClient.js";

import {
  createSmokeContext,
  cleanupSmokeContext,
  writeAnthropicConfig,
  spawnServe,
  waitForPattern,
  pollUntilIdle,
  shutdownServe,
  type SmokeTestContext,
} from "./smoke-api-helpers.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SERVE_TOKEN = "smoke-test-control-plane-token";

describe.skipIf(!ANTHROPIC_API_KEY)(
  "Smoke: Serve mode → real Anthropic API",
  () => {
    let ctx: SmokeTestContext;
    let proc: Subprocess;
    const port = 18321; // high port to avoid collisions
    const baseUrl = `http://127.0.0.1:${port}`;

    beforeEach(async () => {
      ctx = await createSmokeContext();
      await writeAnthropicConfig(ctx, ANTHROPIC_API_KEY!);
    });

    afterEach(async () => {
      if (proc) {
        await shutdownServe(proc, baseUrl, SERVE_TOKEN);
      }
      await cleanupSmokeContext(ctx);
    });

    it("should accept a message via HTTP and return a response in state", async () => {
      proc = spawnServe(
        ctx,
        ["--port", String(port), "--config", ctx.configPath],
        { env: { CONTINUE_SERVE_TOKEN: SERVE_TOKEN } },
      );

      // Wait for the server to start
      await waitForPattern(proc, "Server started", 30000);

      // Send a message
      const msgRes = await fetchServe(
        `${baseUrl}/message`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "Reply with exactly the word 'hello' and nothing else.",
          }),
        },
        SERVE_TOKEN,
      );
      expect(msgRes.ok).toBe(true);

      // Poll until the agent finishes processing
      const state = await pollUntilIdle(baseUrl, 60000, 1000, SERVE_TOKEN);

      // State shape: { session: { history: ChatHistoryItem[] }, ... }
      // Each ChatHistoryItem has { message: { role, content }, ... }
      const history: any[] = state.session?.history ?? [];
      const assistantItems = history.filter(
        (item: any) => item.message?.role === "assistant",
      );
      expect(assistantItems.length).toBeGreaterThan(0);

      const lastMsg = assistantItems[assistantItems.length - 1].message;
      const content =
        typeof lastMsg.content === "string"
          ? lastMsg.content
          : lastMsg.content
              ?.filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("");

      expect(content?.toLowerCase()).toContain("hello");

      // Graceful exit
      const exitRes = await fetchServe(
        `${baseUrl}/exit`,
        { method: "POST" },
        SERVE_TOKEN,
      );
      expect(exitRes.ok).toBe(true);
    });
  },
);
