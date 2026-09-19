import type { ChatHistoryItem, Session } from "core/index.js";

export const REMOTE_PROTOCOL_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type LogLevel = "error" | "warn" | "info" | "debug";
export type PermissionDecision = "approve" | "deny";
export type ToolEventStatus = "success" | "error" | "denied" | "cancelled";

export interface RemoteOptions {
  host: string;
  port: number;
  authToken?: string;
  workspace: string;
  sessionId?: string;
  logLevel: LogLevel;
  corsOrigins: string[];
  readOnly: boolean;
  config?: string;
  org?: string;
  readonly?: boolean;
  auto?: boolean;
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
}

export interface WorkspaceDescriptor {
  id: string;
  name: string;
  readOnly: boolean;
}

export interface SessionSummary {
  id: string;
  title: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  activeRunId: string | null;
  messageCount: number;
}

export interface SessionSnapshot extends SessionSummary {
  history: ChatHistoryItem[];
}

export interface RunAccepted {
  runId: string;
}

export interface ErrorBody {
  error: {
    code: RemoteErrorCode;
    message: string;
    requestId: string;
  };
}

export type RemoteErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "SESSION_NOT_FOUND"
  | "WORKSPACE_NOT_FOUND"
  | "FILE_NOT_FOUND"
  | "PATH_OUTSIDE_WORKSPACE"
  | "PERMISSION_NOT_FOUND"
  | "SESSION_BUSY"
  | "PERMISSION_ALREADY_RESOLVED"
  | "PRECONDITION_FAILED"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "UNSUPPORTED_PROTOCOL_VERSION"
  | "INTERNAL_ERROR";

interface SessionEventCommon {
  v: typeof REMOTE_PROTOCOL_VERSION;
  seq: number;
  ts: string;
  sessionId: string;
}

export type SessionEventPayload =
  | {
      type: "session_created";
      sessionId: string;
      workspaceId: string;
    }
  | {
      type: "session_updated";
      sessionId: string;
      title: string;
      historyLength: number;
    }
  | {
      type: "agent_started";
      sessionId: string;
      runId: string;
    }
  | {
      type: "agent_thinking";
      sessionId: string;
      runId: string;
      message: string;
    }
  | {
      type: "message_start";
      sessionId: string;
      runId: string;
      messageId: string;
      role: "assistant";
    }
  | {
      type: "message_delta";
      sessionId: string;
      runId: string;
      messageId: string;
      delta: string;
    }
  | {
      type: "message_end";
      sessionId: string;
      runId: string;
      messageId: string;
      content: string;
    }
  | {
      type: "tool_start";
      sessionId: string;
      runId: string;
      toolCallId: string;
      name: string;
      args: JsonValue;
    }
  | {
      type: "tool_update";
      sessionId: string;
      runId: string;
      toolCallId: string;
      chunk: string;
    }
  | {
      type: "tool_end";
      sessionId: string;
      runId: string;
      toolCallId: string;
      status: ToolEventStatus;
      result?: string;
    }
  | {
      type: "permission_request";
      sessionId: string;
      runId: string;
      permissionId: string;
      toolCallId: string;
      toolName: string;
      summary: string;
      expiresAt: string;
    }
  | {
      type: "permission_resolved";
      sessionId: string;
      runId: string;
      permissionId: string;
      decision: PermissionDecision;
    }
  | {
      type: "agent_finished";
      sessionId: string;
      runId: string;
      stopReason: "end_turn" | "cancelled" | "error";
    }
  | {
      type: "agent_error";
      sessionId: string;
      runId: string;
      message: string;
    }
  | {
      type: "session_cancelled";
      sessionId: string;
      runId: string;
    }
  | {
      type: "filesystem_changed";
      sessionId: string;
      path?: string;
    }
  | {
      type: "git_changed";
      sessionId: string;
      path?: string;
    }
  | {
      type: "resync_required";
      sessionId: string;
      reason: "replay_window_exceeded" | "backpressure";
    };

export type SequencedServerEvent = SessionEventCommon & SessionEventPayload;

export type ConnectionServerEvent =
  | {
      v: typeof REMOTE_PROTOCOL_VERSION;
      ts: string;
      type: "connected";
      connectionId: string;
      capabilities: string[];
    }
  | {
      v: typeof REMOTE_PROTOCOL_VERSION;
      ts: string;
      type: "server_shutdown";
      reason: "signal" | "error";
    }
  | {
      v: typeof REMOTE_PROTOCOL_VERSION;
      ts: string;
      type: "pong";
      requestId?: string;
    }
  | {
      v: typeof REMOTE_PROTOCOL_VERSION;
      ts: string;
      type: "ack";
      requestId?: string;
      ok: true;
      data?: JsonValue;
    }
  | {
      v: typeof REMOTE_PROTOCOL_VERSION;
      ts: string;
      type: "error";
      requestId?: string;
      ok: false;
      error: {
        code: RemoteErrorCode;
        message: string;
      };
    };

export type ServerEvent = SequencedServerEvent | ConnectionServerEvent;

export type ClientEvent =
  | {
      v?: typeof REMOTE_PROTOCOL_VERSION;
      type: "create_session";
      requestId?: string;
      workspaceId?: string;
    }
  | {
      v?: typeof REMOTE_PROTOCOL_VERSION;
      type: "resume_session";
      requestId?: string;
      sessionId: string;
    }
  | {
      v?: typeof REMOTE_PROTOCOL_VERSION;
      type: "prompt";
      requestId?: string;
      sessionId: string;
      content: string;
      clientMessageId: string;
    }
  | {
      v?: typeof REMOTE_PROTOCOL_VERSION;
      type: "cancel";
      requestId?: string;
      sessionId: string;
    }
  | {
      v?: typeof REMOTE_PROTOCOL_VERSION;
      type: "permission_response";
      requestId?: string;
      sessionId: string;
      permissionId: string;
      decision: PermissionDecision;
    }
  | {
      v?: typeof REMOTE_PROTOCOL_VERSION;
      type: "subscribe";
      requestId?: string;
      sessionId: string;
      afterSeq?: number;
    }
  | {
      v?: typeof REMOTE_PROTOCOL_VERSION;
      type: "unsubscribe";
      requestId?: string;
      sessionId: string;
    }
  | {
      v?: typeof REMOTE_PROTOCOL_VERSION;
      type: "ping";
      requestId?: string;
    };

export interface RemoteSessionState {
  id: string;
  workspaceId: string;
  session: Session;
  createdAt: string;
  updatedAt: string;
}

export function isSequencedEvent(
  event: ServerEvent,
): event is SequencedServerEvent {
  return "seq" in event && typeof event.seq === "number";
}
