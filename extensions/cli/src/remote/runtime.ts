/* eslint-disable max-lines */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ModelConfig } from "@continuedev/config-yaml";
import type { BaseLlmApi } from "@continuedev/openai-adapters";
import type { ChatHistoryItem, Session, ToolStatus } from "core/index.js";
import { getSessionFilePath, isValidSessionId } from "core/util/paths.js";
import { v4 as uuidv4 } from "uuid";

import type { ExtendedCommandOptions } from "../commands/BaseCommandOptions.js";
import { processCommandFlags } from "../flags/flagProcessor.js";
import { toolPermissionManager } from "../permissions/permissionManager.js";
import { initializeServices, services } from "../services/index.js";
import type { ModelServiceState } from "../services/types.js";
import {
  createSession,
  deleteSessionById,
  getSessionPersistenceSnapshot,
  listPersistedSessions,
  loadSessionById,
  setCurrentSession,
  updateSessionHistory,
} from "../session.js";
import { streamChatResponse } from "../stream/streamChatResponse.js";
import type { StreamCallbacks } from "../stream/streamChatResponse.types.js";
import { constructSystemMessage } from "../systemMessage.js";
import { readFilesSet } from "../tools/readFile.js";
import { runWithWorkspace } from "../util/workspace.js";

import { remoteError } from "./errors.js";
import { SessionEventBuffer } from "./eventBuffer.js";
import { redactSecrets, truncate } from "./security.js";
import type {
  JsonValue,
  PermissionDecision,
  RemoteOptions,
  RemoteSessionState,
  RunAccepted,
  SequencedServerEvent,
  SessionEventPayload,
  SessionSnapshot,
  SessionSummary,
  ToolEventStatus,
  WorkspaceDescriptor,
} from "./types.js";

const EVENT_BUFFER_SIZE = 256;
const PERMISSION_TIMEOUT_MS = 120_000;
const MAX_EVENT_STRING_LENGTH = 16_384;
const MAX_EVENT_JSON_LENGTH = 4_096;

interface RemoteSubscriber {
  id: string;
  send: (event: SequencedServerEvent) => boolean;
  close: (code: number, reason: string) => void;
}

interface PendingRemotePermission {
  permissionId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  expiresAt: string;
  timer: NodeJS.Timeout;
}

interface ActiveTool {
  id: string;
  name: string;
}

interface RemoteRun {
  runId: string;
  prompt: string;
  content: string;
  messageId: string;
  abortController: AbortController;
  cancelled: boolean;
  activeTools: Map<string, ActiveTool>;
  pendingPermissions: Set<string>;
  permissionDecisions: Map<string, PermissionDecision>;
  done: Promise<void>;
}

interface StoredRemoteSession extends RemoteSessionState {
  eventBuffer: SessionEventBuffer;
  subscribers: Map<string, RemoteSubscriber>;
  clientMessageIds: Map<string, string>;
  run: RemoteRun | null;
  permissions: Map<string, PendingRemotePermission>;
  resolvedPermissions: Map<string, PermissionDecision>;
}

function createSerializedRuntime() {
  let tail = Promise.resolve();
  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
}

export interface RemoteRuntimeInfo {
  version: string;
  protocol: number;
  capabilities: string[];
  workspaces: WorkspaceDescriptor[];
}

export interface RemoteRuntimeSubscriber {
  id: string;
  send: (event: SequencedServerEvent) => boolean;
  close: (code: number, reason: string) => void;
}

export class RemoteRuntime {
  private readonly sessions = new Map<string, StoredRemoteSession>();
  private readonly serialized = createSerializedRuntime();
  private readonly workspace: WorkspaceDescriptor;
  private readonly workspaceRoot: string;
  private model: ModelConfig | null = null;
  private llmApi: BaseLlmApi | null = null;
  private initialized = false;
  private closed = false;
  private readonly watchers: fs.FSWatcher[] = [];
  private watcherDebounce: NodeJS.Timeout | null = null;

  constructor(private readonly options: RemoteOptions) {
    this.workspaceRoot = options.workspace;
    this.workspace = {
      id: workspaceId(options.workspace),
      name: path.basename(options.workspace) || options.workspace,
      readOnly: options.readOnly,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const commandOptions: ExtendedCommandOptions = {
      config: this.options.config,
      org: this.options.org,
      readonly: this.options.readonly,
      auto: this.options.auto,
      rule: this.options.rule,
      allow: this.options.allow,
      ask: this.options.ask,
      exclude: this.options.exclude,
      agent: this.options.agent,
      model: this.options.model,
      mcp: this.options.mcp,
      betaSubagentTool: this.options.betaSubagentTool,
      betaUploadArtifactTool: this.options.betaUploadArtifactTool,
    };
    const { permissionOverrides } = processCommandFlags(commandOptions);
    await initializeServices({
      options: commandOptions,
      toolPermissionOverrides: permissionOverrides,
      // The remote server is interactive from the permission system's point
      // of view. It never bypasses ask policies; a client must answer them.
      headless: false,
      skipOnboarding: true,
    });
    const modelState = services.model.getState() as ModelServiceState;
    if (!modelState.model || !modelState.llmApi) {
      throw new Error("Continued model service is not initialized");
    }
    this.model = modelState.model;
    this.llmApi = modelState.llmApi;
    this.initialized = true;
    if (this.options.sessionId) {
      await this.loadOrCreateConfiguredSession(this.options.sessionId);
    }
    this.startWorkspaceWatcher();
  }

  getInfo(version: string): RemoteRuntimeInfo {
    return {
      version,
      protocol: 1,
      capabilities: [
        "sessions",
        "prompts",
        "streaming",
        "tools",
        "permissions",
        "workspaces",
        "files",
        "git",
      ],
      workspaces: [this.workspace],
    };
  }

  getWorkspace(workspaceId: string): WorkspaceDescriptor {
    if (workspaceId !== this.workspace.id) {
      throw remoteError("WORKSPACE_NOT_FOUND", "Workspace not found", 404);
    }
    return this.workspace;
  }

  async listSessionSummaries(): Promise<SessionSummary[]> {
    const summaries = new Map<string, SessionSummary>();
    for (const state of this.sessions.values()) {
      summaries.set(state.id, this.toSummary(state));
    }

    const persisted = listPersistedSessions(100);
    for (const summary of persisted) {
      if (summary.workspaceDirectory !== this.workspaceRoot) {
        continue;
      }
      const existing = summaries.get(summary.sessionId);
      if (!existing) {
        summaries.set(summary.sessionId, {
          id: summary.sessionId,
          title: summary.title,
          workspaceId: this.workspace.id,
          createdAt: summary.dateCreated,
          updatedAt: summary.dateCreated,
          activeRunId: null,
          messageCount: 0,
        });
      }
    }

    return [...summaries.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async getSessionSnapshot(
    sessionId: string,
    offset: number,
    limit: number,
  ): Promise<SessionSnapshot> {
    const state = await this.getSession(sessionId);
    const history = getSessionPersistenceSnapshot(state.session).history.slice(
      offset,
      offset + limit,
    );
    return {
      ...this.toSummary(state),
      history,
    };
  }

  async createRemoteSession(
    workspaceId = this.workspace.id,
  ): Promise<SessionSnapshot> {
    this.getWorkspace(workspaceId);
    this.assertOpen();
    const systemMessage = await constructSystemMessage(
      services.toolPermissions.getState().currentMode,
      this.options.rule,
      undefined,
      false,
    );
    const history: ChatHistoryItem[] = systemMessage
      ? [
          {
            message: { role: "system", content: systemMessage },
            contextItems: [],
          },
        ]
      : [];
    const session = createSession(history);
    session.workspaceDirectory = this.workspaceRoot;
    const now = new Date().toISOString();
    const state = this.addSession(session, now, now);
    this.publish(state, {
      type: "session_created",
      sessionId: state.id,
      workspaceId: state.workspaceId,
    });
    return this.getSessionSnapshot(state.id, 0, 100);
  }

  async resumeSession(sessionId: string): Promise<SessionSnapshot> {
    const state = await this.getSession(sessionId);
    return this.getSessionSnapshot(state.id, 0, 100);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const state = await this.getSession(sessionId);
    const run = state.run;
    await this.cancelSession(sessionId);
    if (run) {
      await run.done;
    }
    this.persist(state);
    deleteSessionById(sessionId);
    this.sessions.delete(sessionId);
  }

  async startPrompt(
    sessionId: string,
    content: string,
    clientMessageId: string,
  ): Promise<RunAccepted> {
    const state = await this.getSession(sessionId);
    this.assertOpen();
    const previousRun = state.clientMessageIds.get(clientMessageId);
    if (previousRun) {
      return { runId: previousRun };
    }
    if (state.run) {
      throw remoteError(
        "SESSION_BUSY",
        "Session already has an active run",
        409,
      );
    }

    const runId = uuidv4();
    state.clientMessageIds.set(clientMessageId, runId);
    while (state.clientMessageIds.size > 512) {
      const oldest = state.clientMessageIds.keys().next().value;
      if (typeof oldest === "string") {
        state.clientMessageIds.delete(oldest);
      } else {
        break;
      }
    }
    const run: RemoteRun = {
      runId,
      prompt: content,
      content: "",
      messageId: uuidv4(),
      abortController: new AbortController(),
      cancelled: false,
      activeTools: new Map(),
      pendingPermissions: new Set(),
      permissionDecisions: new Map(),
      done: Promise.resolve(),
    };
    state.run = run;
    state.updatedAt = new Date().toISOString();
    run.done = this.serialized.run(() => this.executeRun(state, run));
    void run.done.catch(() => {
      // executeRun emits a redacted protocol error; the promise is observed so
      // an agent error cannot become an unhandled rejection.
    });
    return { runId };
  }

  async cancelSession(sessionId: string): Promise<void> {
    const state = await this.getSession(sessionId);
    const run = state.run;
    if (!run) {
      return;
    }
    run.cancelled = true;
    run.abortController.abort();
    for (const permissionId of [...run.pendingPermissions]) {
      this.resolvePermissionInternal(state, permissionId, "deny");
    }
    for (const tool of [...run.activeTools.values()]) {
      this.publishToolEnd(state, run, tool.id, "cancelled");
    }
  }

  async resolvePermission(
    permissionId: string,
    decision: PermissionDecision,
    sessionId?: string,
  ): Promise<void> {
    for (const state of this.sessions.values()) {
      if (state.permissions.has(permissionId)) {
        if (sessionId !== undefined && state.id !== sessionId) {
          throw remoteError(
            "PERMISSION_NOT_FOUND",
            "Permission not found",
            404,
          );
        }
        this.resolvePermissionInternal(state, permissionId, decision);
        return;
      }
    }
    for (const state of this.sessions.values()) {
      if (
        state.resolvedPermissions.has(permissionId) &&
        (sessionId === undefined || state.id === sessionId)
      ) {
        throw remoteError(
          "PERMISSION_ALREADY_RESOLVED",
          "Permission has already been resolved",
          409,
        );
      }
    }
    throw remoteError("PERMISSION_NOT_FOUND", "Permission not found", 404);
  }

  subscribe(
    sessionId: string,
    subscriber: RemoteRuntimeSubscriber,
    afterSequence?: number,
  ): void {
    const state = this.getSessionSync(sessionId);
    state.subscribers.set(subscriber.id, subscriber);
    if (afterSequence !== undefined) {
      const replay = state.eventBuffer.replayAfter(afterSequence);
      if (replay.resyncRequired) {
        const resyncEvent = state.eventBuffer.append({
          type: "resync_required",
          sessionId: state.id,
          reason: "replay_window_exceeded",
        });
        this.publishToSubscriber(subscriber, resyncEvent);
      } else {
        for (const event of replay.events) {
          this.publishToSubscriber(subscriber, event);
        }
      }
    }
  }

  unsubscribe(sessionId: string, subscriberId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return;
    }
    state.subscribers.delete(subscriberId);
    if (state.subscribers.size === 0 && state.run) {
      for (const permissionId of [...state.run.pendingPermissions]) {
        this.resolvePermissionInternal(state, permissionId, "deny");
      }
    }
  }

  getReplay(sessionId: string, afterSequence: number): SequencedServerEvent[] {
    return this.getSessionSync(sessionId).eventBuffer.replayAfter(afterSequence)
      .events;
  }

  async shutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.watcherDebounce) {
      clearTimeout(this.watcherDebounce);
      this.watcherDebounce = null;
    }
    for (const watcher of this.watchers.splice(0)) {
      watcher.close();
    }
    for (const state of this.sessions.values()) {
      await this.cancelSessionIfPresent(state);
      this.persist(state);
      for (const subscriber of state.subscribers.values()) {
        subscriber.close(1001, "Server shutting down");
      }
      state.subscribers.clear();
    }
  }

  private async loadOrCreateConfiguredSession(
    sessionId: string,
  ): Promise<void> {
    if (!isValidSessionId(sessionId)) {
      throw new Error("Invalid session ID");
    }
    let session: Session | null = null;
    let exists = false;
    try {
      const sessionPath = getSessionFilePath(sessionId);
      exists = fs.existsSync(sessionPath);
    } catch {
      exists = false;
    }
    if (exists) {
      session = loadSessionById(sessionId);
      if (session && session.workspaceDirectory !== this.workspaceRoot) {
        throw new Error("Configured session belongs to a different workspace");
      }
    }
    if (!session) {
      const systemMessage = await constructSystemMessage(
        services.toolPermissions.getState().currentMode,
        this.options.rule,
        undefined,
        false,
      );
      const history: ChatHistoryItem[] = systemMessage
        ? [
            {
              message: { role: "system", content: systemMessage },
              contextItems: [],
            },
          ]
        : [];
      session = createSession(history, sessionId);
      session.workspaceDirectory = this.workspaceRoot;
    }
    if (!this.sessions.has(session.sessionId)) {
      const now = new Date().toISOString();
      this.addSession(session, now, now);
    }
  }

  private async getSession(sessionId: string): Promise<StoredRemoteSession> {
    const inMemory = this.sessions.get(sessionId);
    if (inMemory) {
      return inMemory;
    }
    if (!isValidSessionId(sessionId)) {
      throw remoteError("SESSION_NOT_FOUND", "Session not found", 404);
    }
    let exists = false;
    try {
      exists = fs.existsSync(getSessionFilePath(sessionId));
    } catch {
      exists = false;
    }
    if (!exists) {
      throw remoteError("SESSION_NOT_FOUND", "Session not found", 404);
    }
    const session = loadSessionById(sessionId);
    if (!session || session.workspaceDirectory !== this.workspaceRoot) {
      throw remoteError("SESSION_NOT_FOUND", "Session not found", 404);
    }
    const now = new Date().toISOString();
    return this.addSession(session, now, now);
  }

  private getSessionSync(sessionId: string): StoredRemoteSession {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw remoteError("SESSION_NOT_FOUND", "Session not found", 404);
    }
    return state;
  }

  private addSession(
    session: Session,
    createdAt: string,
    updatedAt: string,
  ): StoredRemoteSession {
    const state: StoredRemoteSession = {
      id: session.sessionId,
      workspaceId: this.workspace.id,
      session,
      createdAt,
      updatedAt,
      eventBuffer: new SessionEventBuffer(EVENT_BUFFER_SIZE),
      subscribers: new Map(),
      clientMessageIds: new Map(),
      run: null,
      permissions: new Map(),
      resolvedPermissions: new Map(),
    };
    this.sessions.set(state.id, state);
    return state;
  }

  private toSummary(state: StoredRemoteSession): SessionSummary {
    return {
      id: state.id,
      title: state.session.title,
      workspaceId: state.workspaceId,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      activeRunId: state.run?.runId ?? null,
      messageCount: state.session.history.filter(
        (item) => item.message.role !== "system",
      ).length,
    };
  }

  private async executeRun(
    state: StoredRemoteSession,
    run: RemoteRun,
  ): Promise<void> {
    let failed = false;
    try {
      await runWithWorkspace(this.workspaceRoot, async () => {
        if (run.cancelled || this.closed) {
          return;
        }
        readFilesSet.clear();
        setCurrentSession(state.session);
        await services.chatHistory.initialize(state.session, true);
        services.chatHistory.setRemoteMode(true);
        services.chatHistory.setHistory(state.session.history);
        services.chatHistory.addUserMessage(run.prompt);

        this.publish(state, {
          type: "agent_started",
          sessionId: state.id,
          runId: run.runId,
        });
        this.publish(state, {
          type: "message_start",
          sessionId: state.id,
          runId: run.runId,
          messageId: run.messageId,
          role: "assistant",
        });

        const callbacks = this.createCallbacks(state, run);
        try {
          const result = await streamChatResponse(
            services.chatHistory.getHistory(),
            this.model!,
            this.llmApi!,
            run.abortController,
            callbacks,
          );
          if (!run.cancelled && !run.abortController.signal.aborted) {
            this.publish(state, {
              type: "message_end",
              sessionId: state.id,
              runId: run.runId,
              messageId: run.messageId,
              content: truncate(
                redactSecrets(result || run.content),
                MAX_EVENT_STRING_LENGTH,
              ),
            });
          }
        } catch {
          if (!run.cancelled) {
            failed = true;
            this.publish(state, {
              type: "agent_error",
              sessionId: state.id,
              runId: run.runId,
              message: "Agent run failed",
            });
          }
        } finally {
          state.session.history = services.chatHistory.getHistory();
          this.persist(state);
        }
      });
    } finally {
      for (const permissionId of [...run.pendingPermissions]) {
        this.resolvePermissionInternal(state, permissionId, "deny");
      }
      for (const tool of [...run.activeTools.values()]) {
        this.publishToolEnd(
          state,
          run,
          tool.id,
          run.cancelled ? "cancelled" : "error",
        );
      }
      if (run.cancelled) {
        this.publish(state, {
          type: "session_cancelled",
          sessionId: state.id,
          runId: run.runId,
        });
      } else {
        this.publish(state, {
          type: "agent_finished",
          sessionId: state.id,
          runId: run.runId,
          stopReason: failed ? "error" : "end_turn",
        });
      }
      state.run = null;
      state.updatedAt = new Date().toISOString();
      this.publish(state, {
        type: "session_updated",
        sessionId: state.id,
        title: state.session.title,
        historyLength: state.session.history.length,
      });
    }
  }

  private createCallbacks(
    state: StoredRemoteSession,
    run: RemoteRun,
  ): StreamCallbacks {
    const findToolId = (name: string, suppliedId?: string): string => {
      if (suppliedId) {
        return suppliedId;
      }
      const existing = [...run.activeTools.values()].find(
        (tool) => tool.name === name,
      );
      return existing?.id ?? `tool-call-${randomUUID()}`;
    };

    return {
      abortSignal: run.abortController.signal,
      onContent: (delta) => {
        if (run.cancelled || run.abortController.signal.aborted) {
          return;
        }
        run.content += delta;
        this.publish(state, {
          type: "message_delta",
          sessionId: state.id,
          runId: run.runId,
          messageId: run.messageId,
          delta: truncate(redactSecrets(delta), MAX_EVENT_STRING_LENGTH),
        });
      },
      onToolStart: (name, args, suppliedId) => {
        if (run.cancelled || run.abortController.signal.aborted) {
          return;
        }
        const id = findToolId(name, suppliedId);
        if (run.activeTools.has(id)) {
          return;
        }
        run.activeTools.set(id, { id, name });
        this.publish(state, {
          type: "tool_start",
          sessionId: state.id,
          runId: run.runId,
          toolCallId: id,
          name: truncate(name, 256),
          args: this.redactedJson(args),
        });
      },
      onToolResult: (result, name, status, suppliedId) => {
        if (run.cancelled || run.abortController.signal.aborted) {
          return;
        }
        const id = findToolId(name, suppliedId);
        const decision = run.permissionDecisions.get(id);
        const normalized = this.toolStatus(status, decision);
        this.publish(state, {
          type: "tool_update",
          sessionId: state.id,
          runId: run.runId,
          toolCallId: id,
          chunk: truncate(redactSecrets(result), MAX_EVENT_STRING_LENGTH),
        });
        this.publishToolEnd(state, run, id, normalized, result);
      },
      onToolError: (error, name, suppliedId) => {
        if (run.cancelled || run.abortController.signal.aborted) {
          return;
        }
        const id = findToolId(name || "unknown", suppliedId);
        const decision = run.permissionDecisions.get(id);
        this.publishToolEnd(
          state,
          run,
          id,
          decision === "deny" ? "denied" : "error",
          error,
        );
      },
      onToolPermissionRequest: (
        toolName,
        toolArgs,
        permissionId,
        _preview,
        suppliedToolCallId,
      ) => {
        if (run.cancelled || run.abortController.signal.aborted) {
          toolPermissionManager.rejectRequest(permissionId);
          return;
        }
        const toolCallId = findToolId(toolName, suppliedToolCallId);
        const expiresAt = new Date(
          Date.now() + PERMISSION_TIMEOUT_MS,
        ).toISOString();
        const timer = setTimeout(() => {
          if (state.permissions.has(permissionId)) {
            this.resolvePermissionInternal(state, permissionId, "deny");
          }
        }, PERMISSION_TIMEOUT_MS);
        state.permissions.set(permissionId, {
          permissionId,
          sessionId: state.id,
          runId: run.runId,
          toolCallId,
          expiresAt,
          timer,
        });
        run.pendingPermissions.add(permissionId);
        this.publish(state, {
          type: "permission_request",
          sessionId: state.id,
          runId: run.runId,
          permissionId,
          toolCallId,
          toolName: truncate(toolName, 256),
          summary: truncate(
            `Tool ${toolName} requires permission: ${JSON.stringify(this.redactedJson(toolArgs))}`,
            MAX_EVENT_STRING_LENGTH,
          ),
          expiresAt,
        });
      },
      onSystemMessage: (message) => {
        if (!run.cancelled && message.trim()) {
          this.publish(state, {
            type: "agent_thinking",
            sessionId: state.id,
            runId: run.runId,
            message: truncate(redactSecrets(message), MAX_EVENT_STRING_LENGTH),
          });
        }
      },
    };
  }

  private resolvePermissionInternal(
    state: StoredRemoteSession,
    permissionId: string,
    decision: PermissionDecision,
  ): void {
    const pending = state.permissions.get(permissionId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    state.permissions.delete(permissionId);
    state.resolvedPermissions.set(permissionId, decision);
    const run = state.run;
    if (run) {
      run.pendingPermissions.delete(permissionId);
      run.permissionDecisions.set(pending.toolCallId, decision);
    }
    const approved = decision === "approve";
    if (approved) {
      toolPermissionManager.approveRequest(permissionId);
    } else {
      toolPermissionManager.rejectRequest(permissionId);
    }
    this.publish(state, {
      type: "permission_resolved",
      sessionId: state.id,
      runId: pending.runId,
      permissionId,
      decision,
    });
  }

  private publishToolEnd(
    state: StoredRemoteSession,
    run: RemoteRun,
    toolCallId: string,
    status: ToolEventStatus,
    result?: string,
  ): void {
    if (!run.activeTools.has(toolCallId)) {
      return;
    }
    run.activeTools.delete(toolCallId);
    this.publish(state, {
      type: "tool_end",
      sessionId: state.id,
      runId: run.runId,
      toolCallId,
      status,
      ...(result === undefined
        ? {}
        : { result: truncate(redactSecrets(result), MAX_EVENT_STRING_LENGTH) }),
    });
  }

  private toolStatus(
    status: ToolStatus,
    decision?: PermissionDecision,
  ): ToolEventStatus {
    if (decision === "deny") {
      return "denied";
    }
    if (status === "done") {
      return "success";
    }
    if (status === "canceled") {
      return "cancelled";
    }
    return "error";
  }

  private publish(
    state: StoredRemoteSession,
    payload: SessionEventPayload,
  ): SequencedServerEvent {
    const event = state.eventBuffer.append(payload);
    for (const subscriber of state.subscribers.values()) {
      this.publishToSubscriber(subscriber, event);
    }
    return event;
  }

  private publishToSubscriber(
    subscriber: RemoteSubscriber,
    event: SequencedServerEvent,
  ): void {
    try {
      if (!subscriber.send(event)) {
        subscriber.close(1013, "Client is too slow; resubscribe with afterSeq");
      }
    } catch {
      subscriber.close(1011, "Client connection failed");
    }
  }

  private persist(state: StoredRemoteSession): void {
    try {
      setCurrentSession(state.session);
      updateSessionHistory(
        getSessionPersistenceSnapshot(state.session).history,
      );
    } catch {
      // A session with no user/assistant content is intentionally not written
      // by the existing session persistence layer.
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Remote server is shutting down");
    }
  }

  private async cancelSessionIfPresent(
    state: StoredRemoteSession,
  ): Promise<void> {
    if (state.run) {
      await this.cancelSession(state.id);
      await state.run.done;
    }
    for (const permissionId of [...state.permissions.keys()]) {
      this.resolvePermissionInternal(state, permissionId, "deny");
    }
  }

  private redactedJson(value: unknown): JsonValue {
    const seen = new WeakSet<object>();
    const normalize = (input: unknown): JsonValue => {
      if (
        input === null ||
        typeof input === "string" ||
        typeof input === "boolean"
      ) {
        if (typeof input !== "string") {
          return input;
        }
        const redacted = redactSecrets(input);
        const absolutePath =
          path.isAbsolute(redacted) || path.win32.isAbsolute(redacted);
        const workspaceRelative = redacted.startsWith(
          `${this.workspaceRoot}${path.sep}`,
        );
        if (absolutePath && !workspaceRelative) {
          return "[REDACTED_PATH]";
        }
        return truncate(
          workspaceRelative
            ? path.relative(this.workspaceRoot, redacted) || "."
            : redacted,
          MAX_EVENT_STRING_LENGTH,
        );
      }
      if (typeof input === "number") {
        return Number.isFinite(input) ? input : String(input);
      }
      if (Array.isArray(input)) {
        return input.slice(0, 100).map(normalize);
      }
      if (typeof input === "object") {
        if (seen.has(input)) {
          return "[CIRCULAR]";
        }
        seen.add(input);
        const result: Record<string, JsonValue> = {};
        for (const [key, item] of Object.entries(input)) {
          if (/(token|secret|password|api[_-]?key)/i.test(key)) {
            result[key] = "[REDACTED]";
          } else {
            result[key] = normalize(item);
          }
        }
        return result;
      }
      return String(input);
    };
    const normalized = normalize(value);
    const serialized = truncate(
      JSON.stringify(normalized),
      MAX_EVENT_JSON_LENGTH,
    );
    try {
      return JSON.parse(serialized) as JsonValue;
    } catch {
      return "[TRUNCATED]";
    }
  }

  private startWorkspaceWatcher(): void {
    const onChange = (
      _event: string,
      filename: string | Buffer | null,
      isGit = false,
    ) => {
      const changedPath = typeof filename === "string" ? filename : undefined;
      if (this.watcherDebounce) {
        clearTimeout(this.watcherDebounce);
      }
      this.watcherDebounce = setTimeout(() => {
        this.watcherDebounce = null;
        for (const state of this.sessions.values()) {
          this.publish(state, {
            type:
              isGit || changedPath?.startsWith(".git")
                ? "git_changed"
                : "filesystem_changed",
            sessionId: state.id,
            ...(changedPath ? { path: changedPath } : {}),
          });
        }
      }, 250);
    };
    try {
      this.watchers.push(
        fs.watch(this.workspaceRoot, { recursive: true }, onChange),
      );
    } catch {
      try {
        // Linux Node versions do not support recursive fs.watch. A root-level
        // fallback still reports common workspace changes without making the
        // watcher a prerequisite for the API.
        this.watchers.push(fs.watch(this.workspaceRoot, onChange));
      } catch {
        // Watching is best effort and must not prevent the control server from
        // starting.
      }
    }
    const gitDirectory = path.join(this.workspaceRoot, ".git");
    try {
      if (fs.statSync(gitDirectory).isDirectory()) {
        this.watchers.push(
          fs.watch(gitDirectory, (event, filename) =>
            onChange(event, filename, true),
          ),
        );
      }
    } catch {
      // A workspace without a .git directory simply has no Git watcher.
    }
  }
}

function workspaceId(workspaceRoot: string): string {
  return `workspace-${createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16)}`;
}
