import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import type {
  RemoteRuntime,
  RemoteRuntimeInfo,
  RemoteRuntimeSubscriber,
} from "./runtime.js";
import { createRemoteApp, startRemoteServer } from "./server.js";
import type { RemoteOptions, WorkspaceDescriptor } from "./types.js";

interface FakeRuntime {
  getInfo(version: string): RemoteRuntimeInfo;
  getWorkspace(workspaceId: string): WorkspaceDescriptor;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("remote HTTP transport", () => {
  it("keeps health public and protects all other routes", async () => {
    const workspace = mkdtempSync(
      path.join(tmpdir(), "continue-remote-server-"),
    );
    temporaryDirectories.push(workspace);
    const workspaceDescriptor: WorkspaceDescriptor = {
      id: "workspace-test",
      name: "test",
      readOnly: false,
    };
    const runtime: FakeRuntime = {
      getInfo: () => ({
        version: "0.0.0-test",
        protocol: 1,
        capabilities: ["files"],
        workspaces: [workspaceDescriptor],
      }),
      getWorkspace: (id) => {
        if (id !== workspaceDescriptor.id) throw new Error("not found");
        return workspaceDescriptor;
      },
    };
    const app = createRemoteApp(
      runtime as unknown as RemoteRuntime,
      remoteOptions(workspace),
      "test-token",
      () => 0,
    );

    await request(app).get("/health").expect(200);
    await request(app).get("/info").expect(401);
    const response = await request(app)
      .get("/info")
      .set("Authorization", "Bearer test-token")
      .set("X-Request-Id", "request-1")
      .expect(200);
    expect(response.headers["x-request-id"]).toBe("request-1");
    expect(response.body.protocol).toBe(1);
    await request(app)
      .get("/info?token=test-token")
      .set("Authorization", "Bearer test-token")
      .expect(403);
  });

  it("enforces workspace confinement and If-Match writes", async () => {
    const workspace = mkdtempSync(
      path.join(tmpdir(), "continue-remote-files-"),
    );
    temporaryDirectories.push(workspace);
    const filePath = path.join(workspace, "file.txt");
    writeFileSync(filePath, "before", "utf8");
    const descriptor: WorkspaceDescriptor = {
      id: "workspace-test",
      name: "test",
      readOnly: false,
    };
    const runtime: FakeRuntime = {
      getInfo: () => ({
        version: "0.0.0-test",
        protocol: 1,
        capabilities: ["files"],
        workspaces: [descriptor],
      }),
      getWorkspace: () => descriptor,
    };
    const app = createRemoteApp(
      runtime as unknown as RemoteRuntime,
      remoteOptions(workspace),
      "test-token",
      () => 0,
    );
    const headers = { Authorization: "Bearer test-token" };

    const read = await request(app)
      .get("/workspaces/workspace-test/file")
      .query({ path: "file.txt" })
      .set(headers)
      .expect(200);
    expect(read.body.content).toBe("before");
    expect(read.body.etag).toBeTruthy();

    await request(app)
      .put("/workspaces/workspace-test/file")
      .query({ path: "file.txt" })
      .set(headers)
      .send({ content: "after" })
      .expect(412);
    await request(app)
      .put("/workspaces/workspace-test/file")
      .query({ path: "file.txt" })
      .set({ ...headers, "If-Match": read.body.etag })
      .send({ content: "after" })
      .expect(200);
    expect(readFileSync(filePath, "utf8")).toBe("after");

    const outside = await request(app)
      .get("/workspaces/workspace-test/file")
      .query({ path: "../outside.txt" })
      .set(headers)
      .expect(403);
    expect(outside.body.error.code).toBe("PATH_OUTSIDE_WORKSPACE");

    for (const invalidPath of [
      path.join(workspace, "file.txt"),
      "%2e%2e%2Foutside.txt",
      "..\\outside.txt",
      "file.txt\u0000suffix",
    ]) {
      await request(app)
        .get("/workspaces/workspace-test/file")
        .query({ path: invalidPath })
        .set(headers)
        .expect(403);
    }

    const outsideDirectory = mkdtempSync(
      path.join(tmpdir(), "continue-remote-outside-"),
    );
    temporaryDirectories.push(outsideDirectory);
    writeFileSync(path.join(outsideDirectory, "secret.txt"), "secret", "utf8");
    symlinkSync(outsideDirectory, path.join(workspace, "outside-link"), "dir");
    await request(app)
      .get("/workspaces/workspace-test/file")
      .query({ path: "outside-link/secret.txt" })
      .set(headers)
      .expect(403);

    mkdirSync(path.join(workspace, ".git"));
    await request(app)
      .put("/workspaces/workspace-test/file")
      .query({ path: ".git/config" })
      .set({ ...headers, "If-Match": "*" })
      .send({ content: "secret" })
      .expect(403);
  });
});

describe("remote WebSocket transport", () => {
  it("requires authentication and returns structured correlated responses", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "continue-remote-ws-"));
    temporaryDirectories.push(workspace);
    const runtime = new FakeServerRuntime();
    const server = await startRemoteServer(remoteOptions(workspace), {
      installSignalHandlers: false,
      runtime: runtime as unknown as RemoteRuntime,
    });
    const socket = new WebSocket(`${server.url}/ws`, {
      headers: { Authorization: "Bearer test-token" },
    });
    const connected = await nextMessage(socket);
    expect(connected.type).toBe("connected");
    expect(connected.seq).toBeUndefined();

    socket.send(JSON.stringify({ v: 1, type: "ping", requestId: "ping-1" }));
    const pong = await nextMessage(socket);
    expect(pong).toMatchObject({ type: "pong", requestId: "ping-1" });

    socket.send(
      JSON.stringify({
        v: 1,
        type: "subscribe",
        requestId: "subscribe-1",
        sessionId: "session-1",
      }),
    );
    const subscribeAck = await nextMessage(socket);
    expect(subscribeAck).toMatchObject({
      type: "ack",
      requestId: "subscribe-1",
    });
    socket.send(
      JSON.stringify({
        v: 1,
        type: "prompt",
        requestId: "prompt-1",
        sessionId: "session-1",
        content: "hello",
        clientMessageId: "client-1",
      }),
    );
    const promptAck = await nextMessage(socket);
    expect(promptAck).toMatchObject({ type: "ack", requestId: "prompt-1" });
    const delta = await nextMessage(socket);
    expect(delta).toMatchObject({
      type: "message_delta",
      sessionId: "session-1",
      seq: 1,
      delta: "streamed",
    });

    const closed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    socket.send(JSON.stringify({ v: 1, type: "not-a-message" }));
    const error = await nextMessage(socket);
    expect(error).toMatchObject({
      type: "error",
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    await closed;
    await server.close();
  });
});

function remoteOptions(workspace: string): RemoteOptions {
  return {
    host: "127.0.0.1",
    port: 0,
    authToken: "test-token",
    workspace,
    logLevel: "error",
    corsOrigins: [],
    readOnly: false,
  };
}

class FakeServerRuntime {
  private readonly subscribers = new Map<string, RemoteRuntimeSubscriber>();

  async initialize(): Promise<void> {}

  getInfo(): RemoteRuntimeInfo {
    return {
      version: "0.0.0-test",
      protocol: 1,
      capabilities: ["streaming"],
      workspaces: [],
    };
  }

  async shutdown(): Promise<void> {}

  subscribe(sessionId: string, subscriber: RemoteRuntimeSubscriber): void {
    this.subscribers.set(sessionId, subscriber);
  }

  unsubscribe(sessionId: string): void {
    this.subscribers.delete(sessionId);
  }

  async startPrompt(
    sessionId: string,
    _content: string,
    _clientMessageId: string,
  ): Promise<{ runId: string }> {
    const subscriber = this.subscribers.get(sessionId);
    setTimeout(() => {
      subscriber?.send({
        v: 1,
        seq: 1,
        ts: new Date().toISOString(),
        type: "message_delta",
        sessionId,
        runId: "run-1",
        messageId: "message-1",
        delta: "streamed",
      });
    }, 10);
    return { runId: "run-1" };
  }
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      cleanup();
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}
