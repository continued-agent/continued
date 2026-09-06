/**
 * Accept messages only from this webview's own origin and top-level window.
 * VS Code's host bridge can deliver messages with a non-page origin and a
 * parent-frame source. Nested MCP iframes still have a different WindowProxy
 * and are rejected below.
 */
export function isTrustedWebviewMessageEvent(
  event: Pick<MessageEvent, "origin" | "source">,
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const expectedOrigin = window.location.origin;
  const isParentFrameSource =
    window.parent !== window && event.source === window.parent;
  const isTopLevelSource =
    event.source == null || event.source === window || isParentFrameSource;
  // VS Code's webview.postMessage bridge does not expose a browser source
  // window, so its event origin is not stable across VS Code versions. The
  // parent frame is the trusted VS Code container; a nested frame always
  // supplies a different WindowProxy and is rejected below.
  const isHostBridgeMessage =
    event.source == null ||
    isParentFrameSource ||
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
