import { describe, expect, it } from "vitest";

import { isTrustedWebviewMessageEvent } from "./webviewMessageSecurity";

describe("webview message trust boundary", () => {
  it("accepts messages from the current webview window", () => {
    expect(
      isTrustedWebviewMessageEvent({
        origin: window.location.origin,
        source: window,
      }),
    ).toBe(true);
  });

  it("rejects messages from another origin", () => {
    expect(
      isTrustedWebviewMessageEvent({
        origin: "https://attacker.example",
        source: window,
      }),
    ).toBe(false);
  });

  it("rejects messages from a nested window", () => {
    expect(
      isTrustedWebviewMessageEvent({
        origin: window.location.origin,
        source: {} as Window,
      }),
    ).toBe(false);
  });
});
