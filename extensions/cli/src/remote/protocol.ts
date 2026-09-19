import { remoteError } from "./errors.js";
import {
  REMOTE_PROTOCOL_VERSION,
  type ClientEvent,
  type PermissionDecision,
} from "./types.js";

const COMMON_KEYS = ["v", "type", "requestId"] as const;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw remoteError("INVALID_REQUEST", "Request must be a JSON object", 400);
  }
  return value as Record<string, unknown>;
}

function keysAreKnown(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw remoteError("INVALID_REQUEST", `Unknown field: ${key}`, 400);
    }
  }
}

function requiredString(
  value: unknown,
  field: string,
  maxLength = 4096,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw remoteError("INVALID_REQUEST", `Invalid ${field}`, 400);
  }
  return value;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength = 4096,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, field, maxLength);
}

function optionalVersion(value: unknown): void {
  if (value !== undefined && value !== REMOTE_PROTOCOL_VERSION) {
    throw remoteError(
      "UNSUPPORTED_PROTOCOL_VERSION",
      "Unsupported protocol version",
      400,
    );
  }
}

function optionalRequestId(value: unknown): string | undefined {
  return optionalString(value, "requestId", 256);
}

function decision(value: unknown): PermissionDecision {
  if (value !== "approve" && value !== "deny") {
    throw remoteError("INVALID_REQUEST", "Invalid permission decision", 400);
  }
  return value;
}

function optionalSequence(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw remoteError("INVALID_REQUEST", "Invalid afterSeq", 400);
  }
  return value;
}

export function parseClientEvent(value: unknown): ClientEvent {
  const input = record(value);
  const type = requiredString(input.type, "type", 64);
  optionalVersion(input.v);
  const requestId = optionalRequestId(input.requestId);

  switch (type) {
    case "create_session":
      keysAreKnown(input, [...COMMON_KEYS, "workspaceId"]);
      return {
        v: REMOTE_PROTOCOL_VERSION,
        type,
        requestId,
        workspaceId: optionalString(input.workspaceId, "workspaceId", 256),
      };
    case "resume_session":
      keysAreKnown(input, [...COMMON_KEYS, "sessionId"]);
      return {
        v: REMOTE_PROTOCOL_VERSION,
        type,
        requestId,
        sessionId: requiredString(input.sessionId, "sessionId", 128),
      };
    case "prompt":
      keysAreKnown(input, [
        ...COMMON_KEYS,
        "sessionId",
        "content",
        "clientMessageId",
      ]);
      return {
        v: REMOTE_PROTOCOL_VERSION,
        type,
        requestId,
        sessionId: requiredString(input.sessionId, "sessionId", 128),
        content: requiredString(input.content, "content", 1_048_576),
        clientMessageId: requiredString(
          input.clientMessageId,
          "clientMessageId",
          256,
        ),
      };
    case "cancel":
      keysAreKnown(input, [...COMMON_KEYS, "sessionId"]);
      return {
        v: REMOTE_PROTOCOL_VERSION,
        type,
        requestId,
        sessionId: requiredString(input.sessionId, "sessionId", 128),
      };
    case "permission_response":
      keysAreKnown(input, [
        ...COMMON_KEYS,
        "sessionId",
        "permissionId",
        "decision",
      ]);
      return {
        v: REMOTE_PROTOCOL_VERSION,
        type,
        requestId,
        sessionId: requiredString(input.sessionId, "sessionId", 128),
        permissionId: requiredString(input.permissionId, "permissionId", 256),
        decision: decision(input.decision),
      };
    case "subscribe":
      keysAreKnown(input, [...COMMON_KEYS, "sessionId", "afterSeq"]);
      return {
        v: REMOTE_PROTOCOL_VERSION,
        type,
        requestId,
        sessionId: requiredString(input.sessionId, "sessionId", 128),
        afterSeq: optionalSequence(input.afterSeq),
      };
    case "unsubscribe":
      keysAreKnown(input, [...COMMON_KEYS, "sessionId"]);
      return {
        v: REMOTE_PROTOCOL_VERSION,
        type,
        requestId,
        sessionId: requiredString(input.sessionId, "sessionId", 128),
      };
    case "ping":
      keysAreKnown(input, COMMON_KEYS);
      return { v: REMOTE_PROTOCOL_VERSION, type, requestId };
    default:
      throw remoteError(
        "INVALID_REQUEST",
        `Unknown message type: ${type}`,
        400,
      );
  }
}

export interface SessionCreateBody {
  workspaceId?: string;
}

export function parseSessionCreateBody(value: unknown): SessionCreateBody {
  if (value === undefined) {
    return {};
  }
  const input = record(value);
  keysAreKnown(input, ["workspaceId"]);
  return { workspaceId: optionalString(input.workspaceId, "workspaceId", 256) };
}

export interface PromptBody {
  content: string;
  clientMessageId: string;
}

export function parsePromptBody(value: unknown): PromptBody {
  const input = record(value);
  keysAreKnown(input, ["content", "clientMessageId"]);
  return {
    content: requiredString(input.content, "content", 1_048_576),
    clientMessageId: requiredString(
      input.clientMessageId,
      "clientMessageId",
      256,
    ),
  };
}

export interface FileWriteBody {
  content: string;
}

export function parseFileWriteBody(value: unknown): FileWriteBody {
  const input = record(value);
  keysAreKnown(input, ["content"]);
  return { content: requiredString(input.content, "content", 5_242_880) };
}

export interface PermissionResponseBody {
  sessionId?: string;
}

export function parsePermissionResponseBody(
  value: unknown,
): PermissionResponseBody {
  if (value === undefined) {
    return {};
  }
  const input = record(value);
  keysAreKnown(input, ["sessionId"]);
  return { sessionId: optionalString(input.sessionId, "sessionId", 128) };
}

export function parsePagination(query: { offset?: string; limit?: string }): {
  offset: number;
  limit: number;
} {
  const offset = parseBoundedInteger(query.offset, "offset", 0, 1_000_000, 0);
  const limit = parseBoundedInteger(query.limit, "limit", 1, 100, 100);
  return { offset, limit };
}

function parseBoundedInteger(
  value: string | undefined,
  field: string,
  minimum: number,
  maximum: number,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (!/^\d+$/.test(value)) {
    throw remoteError("INVALID_REQUEST", `Invalid ${field}`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw remoteError("INVALID_REQUEST", `Invalid ${field}`, 400);
  }
  return parsed;
}
