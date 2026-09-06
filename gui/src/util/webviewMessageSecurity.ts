/**
 * Accept messages only from this webview's own origin and top-level window.
 * VS Code's host bridge can deliver messages with a non-page origin and a
 * parent-frame source. Nested MCP iframes still have a different WindowProxy
 * and are rejected below.
 */
let trustedWebviewMessageSource: MessageEventSource | null = null;

/**
 * Remember the source of a response whose request ID was generated locally.
 * VS Code removes the webview's `window.parent` reference, so the source of
 * later host events must be learned from the correlated handshake response.
 */
export function rememberTrustedWebviewMessageSource(
  event: Pick<MessageEvent, "source">,
): void {
  if (event.source != null) {
    trustedWebviewMessageSource = event.source;
  }
}

export function isTrustedWebviewMessageEvent(
  event: Pick<MessageEvent, "origin" | "source">,
): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const expectedOrigin = window.location.origin;
  const isKnownBridgeSource =
    event.source != null && event.source === trustedWebviewMessageSource;
  const isTopLevelSource =
    event.source == null || event.source === window || isKnownBridgeSource;
  // VS Code's webview.postMessage bridge does not expose a browser source
  // window, so its event origin is not stable across VS Code versions. The
  // parent frame is the trusted VS Code container; a nested frame always
  // supplies a different WindowProxy and is rejected below.
  const isHostBridgeMessage =
    event.source == null ||
    isKnownBridgeSource ||
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
