import { describe, expect, it } from "vitest";

import { sanitizeMarkdownHref } from "./sanitizeHref";

describe("sanitizeMarkdownHref", () => {
  const baseUrl = "vscode-webview://test/index.html";

  it.each([
    "command:workbench.action.openSettings",
    "COMMAND:run",
    "file:///etc/passwd",
  ])("blocks the %s scheme", (href) => {
    expect(sanitizeMarkdownHref(href, baseUrl)).toBe("#");
  });

  it("retains normal web links", () => {
    expect(sanitizeMarkdownHref("https://continue.dev/docs", baseUrl)).toBe(
      "https://continue.dev/docs",
    );
  });
});
