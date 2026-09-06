import { fetchPublicUrl } from "@continuedev/fetch";
import { describe, expect, it, vi } from "vitest";

import {
  assertSafeFetchUrl,
  isPrivateNetworkAddress,
  safeFetch,
} from "./network.js";

vi.mock("@continuedev/fetch", async () => {
  const actual =
    await vi.importActual<typeof import("@continuedev/fetch")>(
      "@continuedev/fetch",
    );
  return {
    ...actual,
    fetchPublicUrl: vi.fn(),
  };
});

describe("network URL validation", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ])("recognizes private address %s", (address) => {
    expect(isPrivateNetworkAddress(address)).toBe(true);
  });

  it("rejects local destinations before invoking fetch", async () => {
    await expect(
      assertSafeFetchUrl("http://127.0.0.1:8080/state"),
    ).rejects.toThrow("private or local");
  });

  it("rejects non-HTTP schemes", async () => {
    await expect(assertSafeFetchUrl("file:///etc/passwd")).rejects.toThrow(
      "Unsupported URL scheme",
    );
  });

  it("does not follow a redirect to a private address", async () => {
    const fetchMock = vi.mocked(fetchPublicUrl).mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: "http://127.0.0.1/admin" }),
    } as any);

    await expect(safeFetch("http://8.8.8.8/resource")).rejects.toThrow(
      "private or local",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockReset();
  });
});
