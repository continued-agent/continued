import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { env } from "../env.js";

import {
  hasTokenQuery,
  isHostHeaderAllowed,
  isOriginAllowed,
  redactSecrets,
  resolveRemoteToken,
  tokensEqual,
} from "./security.js";

describe("remote security boundaries", () => {
  let temporaryHome: string | undefined;
  const originalHome = env.continueHome;

  afterEach(async () => {
    env.continueHome = originalHome;
    if (temporaryHome) {
      await rm(temporaryHome, { recursive: true, force: true });
      temporaryHome = undefined;
    }
  });

  it("compares tokens without accepting a query-string token", () => {
    expect(tokensEqual("test-token", "test-token")).toBe(true);
    expect(tokensEqual("test-token", "other-token")).toBe(false);
    expect(hasTokenQuery("/ws?token=test-token")).toBe(true);
    expect(hasTokenQuery("/ws?path=src/index.ts")).toBe(false);
  });

  it("validates exact origins and host headers", () => {
    expect(isOriginAllowed(undefined, [])).toBe(true);
    expect(
      isOriginAllowed("http://localhost:3000", ["http://localhost:3000"]),
    ).toBe(true);
    expect(
      isOriginAllowed("http://evil.example", ["http://localhost:3000"]),
    ).toBe(false);
    expect(isHostHeaderAllowed("127.0.0.1:4173", "127.0.0.1", 4173)).toBe(true);
    expect(isHostHeaderAllowed("evil.example:4173", "127.0.0.1", 4173)).toBe(
      false,
    );
    expect(isHostHeaderAllowed("127.0.0.1:4174", "127.0.0.1", 4173)).toBe(
      false,
    );
  });

  it("redacts bearer tokens and secret-like values", () => {
    const redacted = redactSecrets(
      'Authorization: Bearer abc123 api_key="key-value" password=letmein',
    );
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("key-value");
    expect(redacted).not.toContain("letmein");
    expect(redacted).toContain("[REDACTED]");
  });

  it("generates a 32-byte token and does not expose it in its result path", () => {
    const result = resolveRemoteToken("configured-token");
    expect(result).toEqual({ token: "configured-token", generated: false });
    temporaryHome = mkdtempSync(
      path.join(tmpdir(), "continue-remote-security-"),
    );
    env.continueHome = temporaryHome;
    const generated = resolveRemoteToken();
    expect(generated.generated).toBe(true);
    expect(generated.token).toHaveLength(64);
    expect(generated.tokenFilePath).toBeTruthy();
  });
});
