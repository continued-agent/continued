import { assertPublicUrl, isPrivateNetworkAddress } from "@continuedev/fetch";

/**
 * Validates a network MCP server URL before a connection is attempted.
 *
 * MCP server URLs come from config files (including workspace `.continue`
 * configs that may be supplied by a cloned repository), so they are
 * attacker-influenced. We reject:
 *  - unsupported schemes (only http/https/ws/wss are allowed)
 *  - URLs with embedded credentials (userinfo)
 *  - destinations on loopback, RFC1918, link-local (incl. cloud metadata
 *    169.254.169.254) or otherwise private networks, including after DNS
 *    resolution — unless the user explicitly opts in via
 *    CONTINUE_ALLOW_PRIVATE_MCP_SERVERS=true (needed for local dev servers).
 *
 * Shared by the MCP network transports and the OAuth flow so both enforce the
 * same public-only policy.
 */
export function assertSafeMcpServerUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid MCP server URL: ${rawUrl}`);
  }

  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error(`Unsupported MCP server URL scheme: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new Error(
      "MCP server URLs with embedded credentials are not allowed",
    );
  }

  if (process.env.CONTINUE_ALLOW_PRIVATE_MCP_SERVERS === "true") {
    return url;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isPrivateNetworkAddress(hostname)
  ) {
    throw new Error(
      `MCP server URL resolves to a private or local network address (${hostname}). ` +
        `Set CONTINUE_ALLOW_PRIVATE_MCP_SERVERS=true to allow local/dev MCP servers.`,
    );
  }

  return url;
}

/**
 * Validates a network MCP server URL and resolves its hostname up front. The
 * returned URL is only useful for the hostname check; the actual transports
 * pin DNS resolution with {@link publicDnsLookup} so a DNS answer cannot
 * change between validation and socket creation (DNS rebinding).
 */
export async function assertSafeMcpServerUrlWithDns(
  rawUrl: string,
): Promise<URL> {
  const url = assertSafeMcpServerUrl(rawUrl);
  if (process.env.CONTINUE_ALLOW_PRIVATE_MCP_SERVERS === "true") {
    return url;
  }
  // Reuse the fetch package's public-only DNS validation (hostname resolution
  // + blocklist) so MCP transports get the same guarantees as the URL
  // fetcher.
  await assertPublicUrl(url);
  return url;
}
