/**
 * Accept messages only from this webview's own origin and top-level window.
 * Sandboxed MCP iframes have an opaque `null` origin and therefore cannot
 * invoke privileged GUI handlers through the general webview protocol.
 */
export function isTrustedWebviewMessageEvent(
  event: Pick<MessageEvent, "origin" | "source">,
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const expectedOrigin = window.location.origin;
  if (
    !expectedOrigin ||
    expectedOrigin === "null" ||
    event.origin !== expectedOrigin
  ) {
    return false;
  }

  // Some host bridges provide a null source. When present, however, it must be
  // the top-level webview window rather than a nested frame.
  return event.source == null || event.source === window;
}
