import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { env } from "../env.js";
import { ensurePrivateDirectory } from "../util/filePermissions.js";

export { tokensEqual } from "../util/tokenAuth.js";

const TOKEN_BYTES = 32;
const TOKEN_FILE_NAME = "remote-token";

export interface RemoteToken {
  token: string;
  generated: boolean;
  tokenFilePath?: string;
}

export function resolveRemoteToken(configuredToken?: string): RemoteToken {
  const token =
    configuredToken?.trim() || process.env.CONTINUE_REMOTE_TOKEN?.trim();
  if (token) {
    return { token, generated: false };
  }

  const generatedToken = randomBytes(TOKEN_BYTES).toString("hex");
  ensurePrivateDirectory(env.continueHome);
  const tokenFilePath = path.join(env.continueHome, TOKEN_FILE_NAME);
  fs.writeFileSync(tokenFilePath, `${generatedToken}\n`, { mode: 0o600 });
  if (process.platform !== "win32") {
    fs.chmodSync(tokenFilePath, 0o600);
  }
  return { token: generatedToken, generated: true, tokenFilePath };
}

export function bearerTokenFromHeader(
  authorization: string | string[] | undefined,
): string | undefined {
  if (typeof authorization !== "string") {
    return undefined;
  }
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1];
}

export function tokenFromWebSocketHeaders(
  authorization: string | string[] | undefined,
  protocolHeader: string | string[] | undefined,
): string | undefined {
  const bearer = bearerTokenFromHeader(authorization);
  if (bearer) {
    return bearer;
  }
  if (typeof protocolHeader !== "string") {
    return undefined;
  }
  return protocolHeader
    .split(",")
    .map((protocol) => protocol.trim())
    .find((protocol) => protocol.length > 0 && protocol !== "remote.v1");
}

export function hasTokenQuery(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url, "http://localhost");
    return ["token", "authToken", "access_token"].some((key) =>
      parsed.searchParams.has(key),
    );
  } catch {
    return true;
  }
}

function normalizedHost(host: string): string {
  return host.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) {
    return true;
  }
  return allowedOrigins.includes(origin);
}

export function isHostHeaderAllowed(
  hostHeader: string | undefined,
  bindHost: string,
  port: number,
): boolean {
  if (!hostHeader || hostHeader.includes("@")) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    return false;
  }
  if (port !== 0 && (!parsed.port || Number(parsed.port) !== port)) {
    return false;
  }

  const requestedHost = normalizedHost(parsed.hostname);
  const configuredHost = normalizedHost(bindHost);
  const configuredWildcard =
    configuredHost === "0.0.0.0" || configuredHost === "::";
  if (configuredWildcard) {
    // Wildcard listeners accept IP literals on the bound interface, but do not
    // accept arbitrary DNS names that could be rebound to another host.
    return netIsIp(requestedHost) || requestedHost === "localhost";
  }
  if (requestedHost === configuredHost) {
    return true;
  }
  if (configuredHost === "127.0.0.1" || configuredHost === "::1") {
    return (
      requestedHost === "localhost" ||
      requestedHost === "127.0.0.1" ||
      requestedHost === "::1"
    );
  }
  return false;
}

function netIsIp(value: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255);
  }
  return value.includes(":") && /^[0-9a-f:]+$/i.test(value);
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[^\s"']+/gi,
  /(api[_-]?key|token|password|secret)\s*[=:]\s*[^\s,;}]+/gi,
  /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi,
];

export function redactSecrets(value: string): string {
  let redacted = value.replace(SECRET_PATTERNS[0], "Bearer [REDACTED]");
  redacted = redacted.replace(SECRET_PATTERNS[1], "$1=[REDACTED]");
  return redacted.replace(SECRET_PATTERNS[2], "[REDACTED]");
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
