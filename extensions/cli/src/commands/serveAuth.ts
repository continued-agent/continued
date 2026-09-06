import { randomBytes, timingSafeEqual } from "node:crypto";

const SERVE_TOKEN_ENV = "CONTINUE_SERVE_TOKEN";
const SERVE_TOKEN_BYTES = 32;

/**
 * Resolve the per-process control-plane token. A token is generated when the
 * caller did not explicitly provide one, so every server instance is protected
 * even when it is started by an older client.
 */
export function resolveServeToken(configuredToken?: string): {
  token: string;
  generated: boolean;
} {
  const configured =
    configuredToken?.trim() || process.env[SERVE_TOKEN_ENV]?.trim();
  if (configured) {
    return { token: configured, generated: false };
  }

  return {
    token: randomBytes(SERVE_TOKEN_BYTES).toString("hex"),
    generated: true,
  };
}

/** Compare a request's bearer token without leaking token contents. */
export function isServeRequestAuthorized(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) {
    return false;
  }

  const provided = Buffer.from(authorization.slice(prefix.length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}
