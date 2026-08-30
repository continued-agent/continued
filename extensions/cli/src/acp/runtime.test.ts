import type {
  AgentConnection,
  AgentContext,
  ContentBlock,
} from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolPermissionManager } from "../permissions/permissionManager.js";

const harness = vi.hoisted(() => {
  const history: any[] = [];
  const permissions = { currentMode: "normal" as const };
  const model = {
    model: { provider: "openai", model: "test-model" },
    llmApi: {},
  };

  return {
    history,
    permissions,
    model,
    stream: vi.fn(),
    initializeServices: vi.fn(async () => undefined),
    chatHistory: {
      initialize: vi.fn(async (session: any) => {
        history.splice(0, history.length, ...session.history);
      }),
      setHistory: vi.fn((next: any[]) => {
        history.splice(0, history.length, ...next);
      }),
      addUserMessage: vi.fn((content: string) => {
        history.push({ message: { role: "user", content }, contextItems: [] });
      }),
      getHistory: vi.fn(() => [...history]),
    },
    systemMessage: {
      getState: vi.fn(() => ({})),
    },
    toolPermissions: {
      getState: vi.fn(() => permissions),
    },
    modelService: {
      getState: vi.fn(() => model),
    },
    logger: {
      error: vi.fn(),
    },
  };
});

vi.mock("../services/index.js", () => ({
  initializeServices: harness.initializeServices,
  services: {
    chatHistory: harness.chatHistory,
    systemMessage: harness.systemMessage,
    toolPermissions: harness.toolPermissions,
    model: harness.modelService,
  },
}));
vi.mock("../stream/streamChatResponse.js", () => ({
  streamChatResponse: harness.stream,
}));
vi.mock("../systemMessage.js", () => ({
  constructSystemMessage: vi.fn(async () => "system prompt"),
}));
vi.mock("../version.js", () => ({ getVersion: () => "0.0.0-test" }));
vi.mock("../util/logger.js", () => ({ logger: harness.logger }));

const { AcpRuntime } = await import("./runtime.js");

const cwd = process.cwd();

function clientFor(
  optionId: "allow_once" | "reject_once" = "allow_once",
): AgentContext {
  return {
    notify: vi.fn(async () => undefined),
    request: vi.fn(async () => ({
      outcome: { outcome: "selected" as const, optionId },
    })),
  } as unknown as AgentContext;
}

async function makeRuntime(): Promise<InstanceType<typeof AcpRuntime>> {
  const runtime = new AcpRuntime({});
  await runtime.initialize();
  return runtime;
}

async function makeSession(runtime: InstanceType<typeof AcpRuntime>) {
  return (await runtime.newSession({ cwd, mcpServers: [] })).sessionId;
}

describe("ACP runtime", () => {
  beforeEach(() => {
    harness.history.splice(0, harness.history.length);
    harness.stream.mockReset();
    vi.clearAllMocks();
  });

  it("negotiates ACP v1 and identifies Continue without loadSession", async () => {
    const runtime = await makeRuntime();
    const response = runtime.initializeRequest(1);

    expect(response.protocolVersion).toBe(1);
    expect(response.agentInfo).toEqual({
      name: "continue",
      title: "Continue",
      version: "0.0.0-test",
    });
    expect(response.agentCapabilities).not.toHaveProperty("loadSession");
    expect(() => runtime.initializeRequest(2)).toThrow(/Unsupported ACP/);
  });

  it("creates isolated sessions and validates the workspace", async () => {
    const runtime = await makeRuntime();
    const first = await makeSession(runtime);
    const second = await makeSession(runtime);

    expect(first).not.toBe(second);
    await expect(
      runtime.newSession({ cwd: "relative", mcpServers: [] }),
    ).rejects.toThrow(/absolute path/);
    await expect(
      runtime.newSession({ cwd, mcpServers: [{ type: "stdio" }] }),
    ).rejects.toThrow(/client-provided MCP/);
  });

  it("emits assistant chunks and completes a normal prompt", async () => {
    harness.stream.mockImplementation(
      async (_history, _model, _api, _abort, callbacks) => {
        callbacks.onContent("hello");
        return "hello";
      },
    );
    const runtime = await makeRuntime();
    const sessionId = await makeSession(runtime);
    const client = clientFor();

    await expect(
      runtime.prompt(
        { sessionId, prompt: [{ type: "text", text: "hi" }] },
        client,
      ),
    ).resolves.toEqual({ stopReason: "end_turn" });
    expect(client.notify).toHaveBeenCalledWith(
      "session/update",
      expect.objectContaining({
        sessionId,
        update: expect.objectContaining({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello" },
        }),
      }),
    );
  });

  it("does not discard unsupported prompt blocks", async () => {
    const runtime = await makeRuntime();
    const sessionId = await makeSession(runtime);

    await expect(
      runtime.prompt(
        {
          sessionId,
          prompt: [
            {
              type: "image",
              data: "not-supported",
              mimeType: "text/plain",
            } as ContentBlock,
          ],
        },
        clientFor(),
      ),
    ).rejects.toThrow(/Unsupported ACP content block/);
    expect(harness.stream).not.toHaveBeenCalled();
  });

  it("keeps two session histories isolated while serializing turns", async () => {
    const seen: string[][] = [];
    harness.stream.mockImplementation(
      async (history, _model, _api, _abort, callbacks) => {
        seen.push(history.map((item: any) => item.message.content));
        callbacks.onContent("ok");
        return "ok";
      },
    );
    const runtime = await makeRuntime();
    const first = await makeSession(runtime);
    const second = await makeSession(runtime);

    await Promise.all([
      runtime.prompt(
        { sessionId: first, prompt: [{ type: "text", text: "first" }] },
        clientFor(),
      ),
      runtime.prompt(
        { sessionId: second, prompt: [{ type: "text", text: "second" }] },
        clientFor(),
      ),
    ]);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("first");
    expect(seen[0]).not.toContain("second");
    expect(seen[1]).toContain("second");
    expect(seen[1]).not.toContain("first");
  });

  it("returns cancelled and does not cancel another session", async () => {
    let waitForAbort!: () => void;
    harness.stream.mockImplementation(
      async (_history, _model, _api, abortController) => {
        await new Promise<void>((resolve) => {
          waitForAbort = resolve;
          abortController.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return "";
      },
    );
    const runtime = await makeRuntime();
    const first = await makeSession(runtime);
    const second = await makeSession(runtime);
    const firstPrompt = runtime.prompt(
      { sessionId: first, prompt: [{ type: "text", text: "cancel me" }] },
      clientFor(),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    runtime.cancel(first);
    waitForAbort?.();

    await expect(firstPrompt).resolves.toEqual({ stopReason: "cancelled" });
    expect(() => runtime.cancel(second)).not.toThrow();
  });

  it.each([
    ["allow_once", true],
    ["reject_once", false],
  ] as const)(
    "maps %s permission to the Continue manager",
    async (optionId, approved) => {
      harness.stream.mockImplementation(
        async (_history, _model, _api, _abort, callbacks) => {
          callbacks.onToolStart("Write", { filepath: "/tmp/file" }, "tool-1");
          const permission = toolPermissionManager.requestPermission({
            name: "Write",
            arguments: { filepath: "/tmp/file" },
          });
          const requestId = toolPermissionManager
            .getPendingRequestIds()
            .at(-1)!;
          callbacks.onToolPermissionRequest(
            "Write",
            { filepath: "/tmp/file" },
            requestId,
            [],
            "tool-1",
          );
          await permission;
          callbacks.onToolResult(
            "result",
            "Write",
            approved ? "done" : "canceled",
            "tool-1",
          );
          return "";
        },
      );
      const runtime = await makeRuntime();
      const sessionId = await makeSession(runtime);
      const client = clientFor(optionId);

      await expect(
        runtime.prompt(
          { sessionId, prompt: [{ type: "text", text: "write" }] },
          client,
        ),
      ).resolves.toEqual({ stopReason: "end_turn" });
      expect(client.request).toHaveBeenCalledWith(
        "session/request_permission",
        expect.objectContaining({
          options: expect.arrayContaining([
            expect.objectContaining({ kind: "allow_once" }),
            expect.objectContaining({ kind: "reject_once" }),
          ]),
        }),
        expect.objectContaining({
          cancellationSignal: expect.any(AbortSignal),
        }),
      );
      expect(client.notify).toHaveBeenCalledWith(
        "session/update",
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: approved ? "completed" : "failed",
          }),
        }),
      );
    },
  );

  it("cleans up sessions and pending permissions on disconnect", async () => {
    const runtime = await makeRuntime();
    const sessionId = await makeSession(runtime);
    const disconnect = new AbortController();
    runtime.attachConnection({ signal: disconnect.signal } as AgentConnection);
    disconnect.abort();

    await expect(
      runtime.prompt(
        { sessionId, prompt: [{ type: "text", text: "after close" }] },
        clientFor(),
      ),
    ).rejects.toThrow(/not found/);
  });
});
