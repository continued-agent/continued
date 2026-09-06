import { describe, expect, it } from "vitest";

import {
  assertPublicUrl,
  isPrivateNetworkAddress,
  publicDnsLookup,
} from "./networkSecurity.js";

describe("public network request safeguards", () => {
  it.each(["127.0.0.1", "10.0.0.1", "::1", "fc00::1", "::ffff:127.0.0.1"])(
    "recognizes private address %s",
    (address) => {
      expect(isPrivateNetworkAddress(address)).toBe(true);
    },
  );

  it("rejects private URL literals before a request is made", async () => {
    await expect(
      assertPublicUrl("http://127.0.0.1:8000/state"),
    ).rejects.toThrow("private or local");
  });

  it("rejects private DNS answers in the connection-time lookup", async () => {
    await new Promise<void>((resolve) => {
      publicDnsLookup("localhost", {}, (error) => {
        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toContain("private or local");
        resolve();
      });
    });
  });
});
