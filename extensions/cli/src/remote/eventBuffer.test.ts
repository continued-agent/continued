import { describe, expect, it } from "vitest";

import { SessionEventBuffer } from "./eventBuffer.js";

describe("remote event replay", () => {
  it("sequences events per session and detects an expired replay cursor", () => {
    const buffer = new SessionEventBuffer(2);
    buffer.append({
      type: "session_created",
      sessionId: "session-1",
      workspaceId: "workspace-1",
    });
    buffer.append({
      type: "agent_started",
      sessionId: "session-1",
      runId: "run-1",
    });
    buffer.append({
      type: "agent_finished",
      sessionId: "session-1",
      runId: "run-1",
      stopReason: "end_turn",
    });

    expect(buffer.lastSequence).toBe(3);
    expect(buffer.replayAfter(1).events.map((event) => event.seq)).toEqual([
      2, 3,
    ]);
    expect(buffer.replayAfter(0).resyncRequired).toBe(true);
    expect(buffer.replayAfter(3)).toEqual({
      events: [],
      resyncRequired: false,
    });
  });
});
