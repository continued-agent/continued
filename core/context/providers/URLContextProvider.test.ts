import { getUrlContextItems } from "./URLContextProvider";

describe("getUrlContextItems URL validation", () => {
  it.each([
    "http://127.0.0.1:8000/state",
    "http://169.254.169.254/latest/meta-data",
    "http://localhost/admin",
    "http://[::ffff:127.0.0.1]/admin",
    "file:///etc/passwd",
  ])("rejects unsafe URL %s without fetching", async (url) => {
    const fetchFn = jest.fn();

    await expect(getUrlContextItems(url, fetchFn)).rejects.toThrow(
      "private, local, or non-HTTP",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("revalidates redirect destinations", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "<html><body>Example</body></html>",
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: "http://127.0.0.1/admin" }),
      });

    await expect(
      getUrlContextItems("https://example.com", fetchFn),
    ).rejects.toThrow("private, local, or non-HTTP");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("uses the connection-pinned fetch for URL and favicon requests", async () => {
    const normalFetch = jest.fn();
    const publicFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html><body>Example</body></html>",
      headers: new Headers(),
    });

    await getUrlContextItems("https://example.com", normalFetch, publicFetch);

    expect(normalFetch).not.toHaveBeenCalled();
    expect(publicFetch).toHaveBeenCalledTimes(2);
  });
});
