import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { isValidSessionId } from "core/util/paths.js";

import type { LogLevel, RemoteOptions } from "./types.js";

const VALID_LOG_LEVELS: readonly LogLevel[] = [
  "error",
  "warn",
  "info",
  "debug",
];

export interface NoTuiInvocation {
  prompt?: string;
  options: {
    noTui?: boolean;
    print?: boolean;
    resume?: boolean;
    fork?: string;
    session?: string;
    prompt?: string[];
    agent?: string;
    host?: string;
    port?: string;
    authToken?: string;
    workspace?: string;
    logLevel?: string;
    corsOrigin?: string[];
    readOnly?: boolean;
  };
}

export function parseRemotePort(value: string | number | undefined): number {
  const raw = value === undefined ? "4173" : String(value);
  if (!/^\d+$/.test(raw)) {
    throw new Error("Invalid --port: expected an integer between 0 and 65535");
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Invalid --port: expected an integer between 0 and 65535");
  }
  return port;
}

export function parseRemoteLogLevel(value: string | undefined): LogLevel {
  const level = value ?? "info";
  if (!VALID_LOG_LEVELS.includes(level as LogLevel)) {
    throw new Error(
      `Invalid --log-level: expected one of ${VALID_LOG_LEVELS.join(", ")}`,
    );
  }
  return level as LogLevel;
}

export function isLoopbackAddress(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized === "ip6-localhost") {
    return true;
  }
  if (net.isIP(normalized) === 4) {
    return normalized === "127.0.0.1" || normalized.startsWith("127.");
  }
  return normalized === "::1";
}

export async function isLoopbackHost(host: string): Promise<boolean> {
  if (isLoopbackAddress(host)) {
    return true;
  }
  if (net.isIP(host) !== 0) {
    return false;
  }

  try {
    const records = await dns.lookup(host, { all: true });
    return (
      records.length > 0 &&
      records.every((record) => isLoopbackAddress(record.address))
    );
  } catch {
    return false;
  }
}

export function resolveWorkspace(workspace: string | undefined): string {
  const requested = workspace ?? process.cwd();
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(requested));
  } catch {
    throw new Error("Invalid --workspace: directory does not exist");
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error("Invalid --workspace: path is not a directory");
  }
  return resolved;
}

export function validateOriginList(origins: string[] | undefined): string[] {
  const values = origins ?? [];
  for (const origin of values) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid --cors-origin: ${origin}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Invalid --cors-origin: ${origin}`);
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error(`Invalid --cors-origin: ${origin}`);
    }
  }
  return [...values];
}

export function validateNoTuiInvocation(invocation: NoTuiInvocation): string[] {
  const { prompt, options } = invocation;
  const errors: string[] = [];
  if (!options.noTui) {
    return errors;
  }
  if (options.print) {
    errors.push("Error: --no-tui cannot be combined with -p/--print");
  }
  if (prompt) {
    errors.push("Error: --no-tui cannot be combined with a positional prompt");
  }
  if (options.resume) {
    errors.push("Error: use --session instead of --resume with --no-tui");
  }
  if (options.fork) {
    errors.push("Error: --no-tui cannot be combined with --fork");
  }
  if (options.prompt?.length) {
    errors.push("Error: --no-tui cannot be combined with --prompt");
  }
  if (options.agent) {
    errors.push("Error: --no-tui cannot be combined with --agent");
  }
  if (options.session && !isValidSessionId(options.session)) {
    errors.push("Error: --session must be a valid session ID");
  }
  return errors;
}

export async function createRemoteOptions(options: {
  host?: string;
  port?: string | number;
  authToken?: string;
  workspace?: string;
  session?: string;
  logLevel?: string;
  corsOrigin?: string[];
  readOnly?: boolean;
  readonly?: boolean;
  auto?: boolean;
  config?: string;
  org?: string;
  rule?: string[];
  allow?: string[];
  ask?: string[];
  exclude?: string[];
  agent?: string;
  model?: string[];
  mcp?: string[];
  betaStatusTool?: boolean;
  betaSubagentTool?: boolean;
  betaUploadArtifactTool?: boolean;
}): Promise<RemoteOptions> {
  const host = options.host?.trim() || "127.0.0.1";
  if (host.includes("/") || host.includes(" ")) {
    throw new Error("Invalid --host: expected a hostname or IP address");
  }
  const loopback = await isLoopbackHost(host);
  const authToken =
    options.authToken?.trim() || process.env.CONTINUE_REMOTE_TOKEN;
  if (!loopback && !authToken) {
    throw new Error(
      "Refusing to expose the remote server without --auth-token or CONTINUE_REMOTE_TOKEN",
    );
  }
  if (options.session && !isValidSessionId(options.session)) {
    throw new Error("Invalid --session: invalid session ID");
  }
  return {
    host,
    port: parseRemotePort(options.port),
    authToken: authToken?.trim() || undefined,
    workspace: resolveWorkspace(options.workspace),
    sessionId: options.session,
    logLevel: parseRemoteLogLevel(options.logLevel),
    corsOrigins: validateOriginList(options.corsOrigin),
    readOnly: options.readOnly === true,
    readonly: options.readonly,
    auto: options.auto,
    config: options.config,
    org: options.org,
    rule: options.rule,
    allow: options.allow,
    ask: options.ask,
    exclude: options.exclude,
    agent: options.agent,
    model: options.model,
    mcp: options.mcp,
    betaStatusTool: options.betaStatusTool,
    betaSubagentTool: options.betaSubagentTool,
    betaUploadArtifactTool: options.betaUploadArtifactTool,
  };
}
