import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchServe } from "./serveClient.js";

describe("fetchServe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("adds the configured bearer token without placing it in the URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({} as Response);

    await fetchServe("http://127.0.0.1:8000/state", {}, "test-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/state",
      expect.any(Object),
    );
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(requestInit.headers).get("Authorization")).toBe(
      "Bearer test-token",
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain("test-token");
  });

  it("preserves an explicitly supplied Authorization header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({} as Response);

    await fetchServe(
      "http://127.0.0.1:8000/state",
      { headers: { Authorization: "Bearer explicit" } },
      "environment-token",
    );

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(requestInit.headers).get("Authorization")).toBe(
      "Bearer explicit",
    );
  });

  it("does not forward the environment token to a non-loopback URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({} as Response);
    vi.stubEnv("CONTINUE_SERVE_TOKEN", "environment-token");

    await fetchServe("https://remote.example/state");

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(requestInit.headers).has("Authorization")).toBe(false);
  });
});
