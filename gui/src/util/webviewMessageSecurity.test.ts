import { describe, expect, it } from "vitest";

import {
  isTrustedWebviewMessageEvent,
  rememberTrustedWebviewMessageSource,
} from "./webviewMessageSecurity";

describe("webview message trust boundary", () => {
  it("accepts messages from the current webview window", () => {
    expect(
      isTrustedWebviewMessageEvent({
        origin: window.location.origin,
        source: window,
      }),
    ).toBe(true);
  });

  it("accepts host bridge messages with an opaque origin", () => {
    expect(
      isTrustedWebviewMessageEvent({
        origin: "vscode-webview://extension-host",
        source: null,
      }),
    ).toBe(true);

    expect(
      isTrustedWebviewMessageEvent({
        origin: "null",
        source: window,
      }),
    ).toBe(true);
  });

  it("accepts messages from the trusted parent webview frame", () => {
    const originalParent = window.parent;
    const parentFrame = {} as Window;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parentFrame,
    });

    try {
      rememberTrustedWebviewMessageSource({ source: parentFrame });
      expect(
        isTrustedWebviewMessageEvent({
          origin: "vscode-webview://host",
          source: parentFrame,
        }),
      ).toBe(true);
    } finally {
      Object.defineProperty(window, "parent", {
        configurable: true,
        value: originalParent,
      });
    }
  });

  it("accepts messages from a source learned through a correlated response", () => {
    const bridgeSource = {} as Window;
    rememberTrustedWebviewMessageSource({ source: bridgeSource });

    expect(
      isTrustedWebviewMessageEvent({
        origin: "vscode-webview://host",
        source: bridgeSource,
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
