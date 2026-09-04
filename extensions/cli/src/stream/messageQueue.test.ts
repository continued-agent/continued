import { describe, expect, it, vi } from "vitest";

vi.mock("../util/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
    configureHeadlessMode: vi.fn(),
    getLogPath: vi.fn(),
    getSessionId: vi.fn(),
  },
}));

import { messageQueue } from "./messageQueue.js";

describe("messageQueue", () => {
  it("enqueues and emits messageQueued", async () => {
    const event = new Promise<any>((resolve) =>
      messageQueue.once("messageQueued", resolve),
    );

    const ok = await messageQueue.enqueueMessage("hello world");
    expect(ok).toBe(true);
    expect(messageQueue.getQueueLength()).toBe(1);

    const queued = await event;
    expect(queued.message).toBe("hello world");
    expect(messageQueue.getNextMessage()?.message).toBe("hello world");
  });

  it("applies a bounded queue limit", async () => {
    const { MAX_QUEUED_MESSAGES } = await import("./messageQueue.js");

    for (let i = 0; i < MAX_QUEUED_MESSAGES; i++) {
      await expect(messageQueue.enqueueMessage(`message-${i}`)).resolves.toBe(
        true,
      );
    }
    await expect(messageQueue.enqueueMessage("overflow")).resolves.toBe(false);

    while (messageQueue.getNextMessage()) {
      // Drain the singleton queue for isolation from other tests.
    }
  });
});
