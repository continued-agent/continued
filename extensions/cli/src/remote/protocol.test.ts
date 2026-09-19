import { describe, expect, it } from "vitest";

import { parseClientEvent, parseFileWriteBody } from "./protocol.js";

describe("remote protocol validation", () => {
  it("rejects unknown message fields and unsupported versions", () => {
    expect(() => parseClientEvent({ type: "ping", unexpected: true })).toThrow(
      /Unknown field/,
    );
    expect(() => parseClientEvent({ v: 2, type: "ping" })).toThrow(
      /Unsupported protocol version/,
    );
  });

  it("requires an idempotency key for prompts and rejects unknown body fields", () => {
    expect(() =>
      parseClientEvent({ type: "prompt", sessionId: "s", content: "hello" }),
    ).toThrow(/clientMessageId/);
    expect(() => parseFileWriteBody({ content: "x", mode: "w" })).toThrow(
      /Unknown field/,
    );
  });

  it("accepts strict prompt and permission messages", () => {
    expect(
      parseClientEvent({
        v: 1,
        type: "prompt",
        sessionId: "session-1",
        content: "hello",
        clientMessageId: "client-1",
      }),
    ).toMatchObject({ type: "prompt", clientMessageId: "client-1" });
    expect(
      parseClientEvent({
        type: "permission_response",
        sessionId: "session-1",
        permissionId: "permission-1",
        decision: "deny",
      }),
    ).toMatchObject({ decision: "deny" });
    expect(() =>
      parseClientEvent({
        type: "permission_response",
        permissionId: "permission-1",
        decision: "deny",
      }),
    ).toThrow(/sessionId/);
  });
});
