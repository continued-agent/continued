import { createHash } from "node:crypto";

import { InternalMcpOptions } from "../..";
import { GlobalContext } from "../../util/GlobalContext";

/**
 * Workspace-supplied MCP servers (e.g. `.continue/mcpServers/*.json` inside a
 * cloned repository) can execute arbitrary commands on the machine running the
 * IDE/CLI. Opening a malicious repository would otherwise start those servers
 * without any user consent, so we require an explicit, per-configuration
 * approval before a stdio MCP server from the workspace is started.
 *
 * Approval is keyed by a fingerprint of the full transport configuration
 * (command, args, env, cwd). If the configuration changes, the fingerprint
 * changes and the server is treated as unapproved again.
 */
const APPROVAL_STORAGE_KEY = "approvedWorkspaceMcpServers" as const;

export type WorkspaceMcpApproval = {
  /** SHA-256 of the canonical transport configuration JSON. */
  fingerprint: string;
  /** ISO timestamp of when the user approved this configuration. */
  approvedAt: string;
};

type ApprovalStorage = {
  [fingerprint: string]: WorkspaceMcpApproval;
};

export function getMcpServerFingerprint(options: InternalMcpOptions): string {
  const canonical = JSON.stringify({
    type: "command" in options ? (options.type ?? "stdio") : options.type,
    command: "command" in options ? options.command : undefined,
    args: "args" in options ? (options.args ?? []) : undefined,
    env: "env" in options ? (options.env ?? {}) : undefined,
    cwd: "cwd" in options ? (options.cwd ?? undefined) : undefined,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * A stdio MCP server is "workspace-supplied" when it was declared by a file
 * inside the workspace (e.g. `.continue/mcpServers/*.json` in a cloned
 * repository) rather than by the user's own global config. Such servers can
 * execute arbitrary commands when started, so opening an untrusted repository
 * must not start them without explicit user approval.
 */
export function isWorkspaceMcpServer(options: InternalMcpOptions): boolean {
  return "command" in options && options.sourceFile !== undefined;
}

function readApprovals(): ApprovalStorage {
  const stored = new GlobalContext().get(APPROVAL_STORAGE_KEY) ?? {};
  const approvals: ApprovalStorage = {};
  for (const [fingerprint, value] of Object.entries(stored)) {
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as WorkspaceMcpApproval).fingerprint === "string" &&
      typeof (value as WorkspaceMcpApproval).approvedAt === "string"
    ) {
      approvals[fingerprint] = value as WorkspaceMcpApproval;
    }
  }
  return approvals;
}

function writeApprovals(approvals: ApprovalStorage): void {
  new GlobalContext().update(APPROVAL_STORAGE_KEY, approvals);
}

export function isWorkspaceMcpServerApproved(
  options: InternalMcpOptions,
): boolean {
  const fingerprint = getMcpServerFingerprint(options);
  return fingerprint in readApprovals();
}

export function approveWorkspaceMcpServer(options: InternalMcpOptions): void {
  const fingerprint = getMcpServerFingerprint(options);
  const approvals = readApprovals();
  approvals[fingerprint] = {
    fingerprint,
    approvedAt: new Date().toISOString(),
  };
  writeApprovals(approvals);
}

export function revokeWorkspaceMcpServerApproval(
  options: InternalMcpOptions,
): void {
  const fingerprint = getMcpServerFingerprint(options);
  const approvals = readApprovals();
  delete approvals[fingerprint];
  writeApprovals(approvals);
}
