/**
 * Send a request to a `cn serve` control plane using the configured bearer
 * token. The token is intentionally read from the environment rather than
 * embedded in URLs, which keeps it out of logs and browser history.
 */
function isLoopbackUrl(input: string): boolean {
  try {
    const hostname = new URL(input).hostname.replace(/^\[|\]$/g, "");
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

export function fetchServe(
  input: string,
  init: RequestInit = {},
  token?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const configuredToken =
    token?.trim() ||
    (isLoopbackUrl(input)
      ? process.env.CONTINUE_SERVE_TOKEN?.trim()
      : undefined);
  if (configuredToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${configuredToken}`);
  }

  return fetch(input, { ...init, headers });
}
