import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolPermissionManager } from "../permissions/permissionManager.js";

const harness = vi.hoisted(() => {
  const history: Array<{
    message: { role: string; content: string };
    contextItems: [];
  }> = [];
  const stream = vi.fn();
  return {
    history,
    stream,
    initializeServices: vi.fn(async () => undefined),
    services: {
      model: {
        getState: vi.fn(() => ({
          model: { model: "test-model", provider: "test" },
          llmApi: {},
        })),
      },
      toolPermissions: {
        getState: vi.fn(() => ({ currentMode: "normal" })),
      },
      chatHistory: {
        initialize: vi.fn(async (session: { history: typeof history }) => {
          history.splice(0, history.length, ...session.history);
        }),
        setRemoteMode: vi.fn(),
        setHistory: vi.fn((next: typeof history) => {
          history.splice(0, history.length, ...next);
        }),
        addUserMessage: vi.fn((content: string) => {
          history.push({
            message: { role: "user", content },
            contextItems: [],
          });
        }),
        getHistory: vi.fn(() => [...history]),
        isReady: vi.fn(() => true),
      },
    },
  };
});

vi.mock("../services/index.js", () => ({
  initializeServices: harness.initializeServices,
  services: harness.services,
}));
vi.mock("../systemMessage.js", () => ({
  constructSystemMessage: vi.fn(async () => "system prompt"),
}));
vi.mock("../stream/streamChatResponse.js", () => ({
  streamChatResponse: harness.stream,
}));
vi.mock("../flags/flagProcessor.js", () => ({
  processCommandFlags: vi.fn(() => ({ permissionOverrides: {} })),
}));

const { RemoteRuntime } = await import("./runtime.js");

describe("remote runtime", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), "continue-remote-runtime-"));
    harness.history.splice(0, harness.history.length);
    harness.stream.mockReset();
  });

  it("keeps session histories isolated while serializing turns", async () => {
    const seen: string[][] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let streamCount = 0;
    harness.stream.mockImplementation(
      async (
        history: typeof harness.history,
        _model: unknown,
        _api: unknown,
        _abort: AbortController,
        callbacks: { onContent: (value: string) => void },
      ) => {
        streamCount += 1;
        seen.push(history.map((item) => item.message.content));
        callbacks.onContent("reply");
        if (streamCount === 1) {
          await firstGate;
        }
        return "reply";
      },
    );
    const runtime = new RemoteRuntime({
      host: "127.0.0.1",
      port: 0,
      workspace,
      logLevel: "error",
      corsOrigins: [],
      readOnly: false,
    });
    await runtime.initialize();
    const first = await runtime.createRemoteSession();
    const second = await runtime.createRemoteSession();
    const firstEvents: string[] = [];
    const secondEvents: string[] = [];
    const subscribe = (sessionId: string, events: string[]) =>
      runtime.subscribe(sessionId, {
        id: `subscriber-${sessionId}`,
        send: (event) => {
          events.push(event.type);
          return true;
        },
        close: () => undefined,
      });
    subscribe(first.id, firstEvents);
    subscribe(second.id, secondEvents);

    const firstRun = await runtime.startPrompt(first.id, "first", "client-1");
    expect(await runtime.startPrompt(first.id, "first", "client-1")).toEqual(
      firstRun,
    );
    await expect(
      runtime.startPrompt(first.id, "another", "client-2"),
    ).rejects.toThrow(/active run/);
    await runtime.startPrompt(second.id, "second", "client-3");
    releaseFirst();

    await vi.waitFor(() => {
      expect(firstEvents).toContain("agent_finished");
      expect(secondEvents).toContain("agent_finished");
    });
    expect(seen[0]).toContain("first");
    expect(seen[0]).not.toContain("second");
    expect(seen[1]).toContain("second");
    expect(seen[1]).not.toContain("first");
    await runtime.shutdown();
    await rm(workspace, { recursive: true, force: true });
  });

  it("routes remote permission decisions through the existing permission manager", async () => {
    let permissionReady!: (permissionId: string) => void;
    const permissionEvent = new Promise<string>((resolve) => {
      permissionReady = resolve;
    });
    harness.stream.mockImplementation(
      async (
        _history: typeof harness.history,
        _model: unknown,
        _api: unknown,
        _abort: AbortController,
        callbacks: {
          onToolStart: (
            name: string,
            args: Record<string, unknown>,
            id: string,
          ) => void;
          onToolPermissionRequest: (
            name: string,
            args: Record<string, unknown>,
            permissionId: string,
            preview: [],
            toolCallId: string,
          ) => void;
          onToolResult: (
            result: string,
            name: string,
            status: "done",
            id: string,
          ) => void;
        },
      ) => {
        callbacks.onToolStart("Write", {}, "tool-1");
        const permissionPromise = toolPermissionManager.requestPermission({
          name: "Write",
          arguments: {},
        });
        const permissionId = toolPermissionManager
          .getPendingRequestIds()
          .at(-1)!;
        callbacks.onToolPermissionRequest(
          "Write",
          {},
          permissionId,
          [],
          "tool-1",
        );
        permissionReady(permissionId);
        await permissionPromise;
        callbacks.onToolResult("denied", "Write", "done", "tool-1");
        return "";
      },
    );
    const runtime = new RemoteRuntime({
      host: "127.0.0.1",
      port: 0,
      workspace,
      logLevel: "error",
      corsOrigins: [],
      readOnly: false,
    });
    await runtime.initialize();
    const session = await runtime.createRemoteSession();
    const events: Array<{
      type: string;
      permissionId?: string;
      status?: string;
    }> = [];
    const finished = new Promise<void>((resolve) => {
      runtime.subscribe(session.id, {
        id: "permission-subscriber",
        send: (event) => {
          events.push({
            type: event.type,
            ...(event.type === "permission_request" ||
            event.type === "permission_resolved"
              ? { permissionId: event.permissionId }
              : {}),
            ...(event.type === "tool_end" ? { status: event.status } : {}),
          });
          if (event.type === "agent_finished") resolve();
          return true;
        },
        close: () => undefined,
      });
    });

    await runtime.startPrompt(session.id, "write", "permission-client");
    const permissionId = await permissionEvent;
    await runtime.resolvePermission(permissionId, "deny");
    await finished;
    expect(events).toContainEqual({
      type: "permission_resolved",
      permissionId,
    });
    expect(events).toContainEqual({ type: "tool_end", status: "denied" });
    await expect(
      runtime.resolvePermission(permissionId, "approve", "other-session"),
    ).rejects.toThrow(/Permission not found/);
    await expect(
      runtime.resolvePermission(permissionId, "approve"),
    ).rejects.toThrow(/already been resolved/);
    await runtime.shutdown();
    await rm(workspace, { recursive: true, force: true });
  });
});
