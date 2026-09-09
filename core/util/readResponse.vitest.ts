import { describe, expect, it } from "vitest";

import { readResponseTextWithLimit } from "./readResponse";

function responseFromChunks(chunks: Uint8Array[]): Response {
  const iterator = async function* () {
    yield* chunks;
  };

  return {
    body: {
      [Symbol.asyncIterator]: iterator,
    },
    headers: new Headers(),
    text: async () => "",
  } as unknown as Response;
}

describe("readResponseTextWithLimit", () => {
  it("reads a streamed response below the limit", async () => {
    await expect(
      readResponseTextWithLimit(
        responseFromChunks([new TextEncoder().encode("hello")]),
        10,
      ),
    ).resolves.toBe("hello");
  });

  it("rejects an oversized streamed response", async () => {
    await expect(
      readResponseTextWithLimit(
        responseFromChunks([new TextEncoder().encode("too large")]),
        3,
      ),
    ).rejects.toThrow("byte limit");
  });
});
