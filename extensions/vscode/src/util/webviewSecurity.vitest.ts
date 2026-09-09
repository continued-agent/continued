import { describe, expect, it } from "vitest";

import {
  getWebviewContentSecurityPolicy,
  serializeForInlineScript,
} from "./webviewSecurity";

describe("webview security helpers", () => {
  it("escapes values that could close an inline script", () => {
    expect(serializeForInlineScript("</script><script>alert(1)</script>")).toBe(
      '"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"',
    );
  });

  it("only permits the development server in development mode", () => {
    const productionPolicy = getWebviewContentSecurityPolicy(
      "vscode-webview://test",
      "nonce",
      false,
    );
    const developmentPolicy = getWebviewContentSecurityPolicy(
      "vscode-webview://test",
      "nonce",
      true,
    );

    expect(productionPolicy).toContain("default-src 'none'");
    expect(productionPolicy).toContain("script-src 'nonce-nonce'");
    expect(productionPolicy).not.toContain("localhost:5173");
    expect(developmentPolicy).toContain("http://localhost:5173");
  });
});
