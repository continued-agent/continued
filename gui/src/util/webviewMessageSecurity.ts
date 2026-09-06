/**
 * Accept messages only from this webview's own origin and top-level window.
 * VS Code's host bridge can deliver messages with an opaque origin and no
 * source window; nested MCP iframes still have a non-null WindowProxy and are
 * rejected below.
 */
export function isTrustedWebviewMessageEvent(
  event: Pick<MessageEvent, "origin" | "source">,
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const expectedOrigin = window.location.origin;
  const isHostBridgeMessage =
    event.source == null && (event.origin === "" || event.origin === "null");
  if (
    !expectedOrigin ||
    (!isHostBridgeMessage && event.origin !== expectedOrigin)
  ) {
    return false;
  }

  // Some host bridges provide a null source. When present, however, it must be
  // the top-level webview window rather than a nested frame.
  return event.source == null || event.source === window;
}
