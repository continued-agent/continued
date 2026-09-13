import { describe, expect, it } from "vitest";

import { redactHeader, sanitizeUrlForLogging } from "./fetch.js";

describe("verbose fetch log redaction", () => {
  it("redacts request and response credential headers", () => {
    for (const header of [
      "authorization",
      "Authorization",
      "cookie",
      "set-cookie",
      "www-authenticate",
      "x-api-key",
      "proxy-authorization",
    ]) {
      expect(redactHeader(header, "secret-value")).toBe("<redacted>");
    }
    expect(redactHeader("content-type", "application/json")).toBe(
      "application/json",
    );
  });

  it("strips credentials and sensitive query params from logged URLs", () => {
    const sanitized = sanitizeUrlForLogging(
      "https://user:pass@example.com/api?TOKEN=abc&api_key=def&ok=1",
    );
    expect(sanitized).not.toContain("user");
    expect(sanitized).not.toContain("pass");
    expect(sanitized).not.toContain("abc");
    expect(sanitized).not.toContain("def");
    expect(sanitized).toContain("ok=1");
  });
});
