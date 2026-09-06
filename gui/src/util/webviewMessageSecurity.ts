/**
 * Accept messages only from this webview's own origin and top-level window.
 * VS Code's host bridge can deliver messages with a non-page origin and no
 * source window. Nested MCP iframes still have a different WindowProxy and
 * are rejected below.
 */
export function isTrustedWebviewMessageEvent(
  event: Pick<MessageEvent, "origin" | "source">,
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const expectedOrigin = window.location.origin;
  const isTopLevelSource = event.source == null || event.source === window;
  // VS Code's webview.postMessage bridge does not expose a browser source
  // window, so its event origin is not stable across VS Code versions. A
  // nested frame always supplies its own WindowProxy and is rejected below.
  const isHostBridgeMessage =
    event.source == null ||
    (isTopLevelSource && (event.origin === "" || event.origin === "null"));
  if (
    !expectedOrigin ||
    (!isHostBridgeMessage && event.origin !== expectedOrigin)
  ) {
    return false;
  }

  // Some host bridges provide a null source. When present, however, it must be
  // the top-level webview window rather than a nested frame.
  return isTopLevelSource;
}
