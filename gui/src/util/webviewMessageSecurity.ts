/**
 * Accept messages only from this webview's own origin and top-level window.
 * VS Code's host bridge can deliver messages with an opaque origin. Nested MCP
 * iframes still have a different WindowProxy and are rejected below.
 */
export function isTrustedWebviewMessageEvent(
  event: Pick<MessageEvent, "origin" | "source">,
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const expectedOrigin = window.location.origin;
  const isTopLevelSource = event.source == null || event.source === window;
  const isOpaqueHostBridgeOrigin =
    event.origin === "" || event.origin === "null";
  if (
    !expectedOrigin ||
    (!isOpaqueHostBridgeOrigin && event.origin !== expectedOrigin)
  ) {
    return false;
  }

  // Some host bridges provide a null source. When present, however, it must be
  // the top-level webview window rather than a nested frame.
  return isTopLevelSource;
}
