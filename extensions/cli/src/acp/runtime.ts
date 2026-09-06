import {
  type AgentConnection,
  type AgentContext,
  type ContentBlock,
  type SessionNotification,
  type ToolCallStatus,
  methods,
  PROTOCOL_VERSION,
  type InitializeResponse,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type { ModelConfig } from "@continuedev/config-yaml";
import type { BaseLlmApi } from "@continuedev/openai-adapters";
import type { ChatHistoryItem, Session } from "core/index.js";
import { v4 as uuidv4 } from "uuid";

import type { ExtendedCommandOptions } from "../commands/BaseCommandOptions.js";
import { processCommandFlags } from "../flags/flagProcessor.js";
import { toolPermissionManager } from "../permissions/permissionManager.js";
import { initializeServices, services } from "../services/index.js";
import { ModelServiceState } from "../services/types.js";
import { setCurrentSession } from "../session.js";
import { streamChatResponse } from "../stream/streamChatResponse.js";
import { StreamCallbacks } from "../stream/streamChatResponse.types.js";
import { constructSystemMessage } from "../systemMessage.js";
import { readFilesSet } from "../tools/readFile.js";
import { logger } from "../util/logger.js";
import { runWithWorkspace } from "../util/workspace.js";
import { getVersion } from "../version.js";

import {
  absoluteLocations,
  sessionFromHistory,
  textContent,
  toPromptText,
  toolKind,
  toolStatus,
  validateDirectory,
} from "./helpers.js";

export interface AcpOptions extends ExtendedCommandOptions {
  mcp?: string[];
}

interface PendingAcpPermission {
  requestId: string;
  toolCallId: string;
}

interface AcpSession {
  id: string;
  cwd: string;
  session: Session;
  model: ModelConfig;
  llmApi: BaseLlmApi;
  abortController: AbortController | null;
  pendingPermission: PendingAcpPermission | null;
  promptInFlight: boolean;
  notificationChain: Promise<void>;
  closed: boolean;
}

/**
 * Serializes access to Continue's process-wide services. The current CLI
 * stream and permission services are singletons, so ACP sessions may exist at
 * the same time but their turns are deliberately processed one at a time.
 */
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

export class AcpRuntime {
  private readonly sessions = new Map<string, AcpSession>();
  private readonly serialized = createSerializedRuntime();
  private closed = false;

  constructor(private readonly options: AcpOptions) {}

  async initialize(): Promise<void> {
    const { permissionOverrides } = processCommandFlags(this.options);
    await initializeServices({
      options: this.options,
      toolPermissionOverrides: permissionOverrides,
      // ACP is interactive from the tool-permission perspective: ask policies
      // must wait for session/request_permission rather than being headless.
      headless: false,
      skipOnboarding: true,
    });
    const modelState = services.model.getState() as ModelServiceState;
    if (!modelState.model || !modelState.llmApi) {
      throw new Error("Continue model service is not initialized");
    }
  }

  initializeRequest(protocolVersion: number): InitializeResponse {
    if (protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(
        `Unsupported ACP protocol version ${protocolVersion}; Continue supports ACP v${PROTOCOL_VERSION}`,
      );
    }

    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: "continue",
        title: "Continue",
        version: this.version(),
      },
      // Baseline ACP capabilities (session/new, session/prompt, and
      // session/cancel) are supported. Do not advertise session/load.
      agentCapabilities: {},
    };
  }

  async newSession(params: {
    cwd: string;
    additionalDirectories?: string[];
    mcpServers: unknown[];
  }): Promise<NewSessionResponse> {
    try {
      if (this.closed) {
        throw new Error("ACP connection is closed");
      }

      const cwd = await validateDirectory(params.cwd, "cwd");
      if (params.additionalDirectories?.length) {
        for (const [
          index,
          directory,
        ] of params.additionalDirectories.entries()) {
          await validateDirectory(directory, `additionalDirectories[${index}]`);
        }
        throw new Error(
          "Continue ACP does not support additionalDirectories yet; omit them or use cwd",
        );
      }
      if (params.mcpServers.length) {
        throw new Error(
          "Continue ACP does not support client-provided MCP servers yet; pass mcpServers: []",
        );
      }

      const permissionState = services.toolPermissions.getState();
      const systemMessage = await runWithWorkspace(cwd, () =>
        constructSystemMessage(
          permissionState.currentMode,
          this.options.rule,
          undefined,
          false,
        ),
      );
      const sessionId = uuidv4();
      const history: ChatHistoryItem[] = [
        {
          message: { role: "system", content: systemMessage },
          contextItems: [],
        },
      ];
      const modelState = services.model.getState() as ModelServiceState;
      if (!modelState.model || !modelState.llmApi) {
        throw new Error("Continue model service is not initialized");
      }

      this.sessions.set(sessionId, {
        id: sessionId,
        cwd,
        session: sessionFromHistory(sessionId, cwd, history),
        model: modelState.model,
        llmApi: modelState.llmApi,
        abortController: null,
        pendingPermission: null,
        promptInFlight: false,
        notificationChain: Promise.resolve(),
        closed: false,
      });

      return { sessionId };
    } catch (error) {
      logger.error("ACP session creation failed", error as Error);
      throw error;
    }
  }

  async prompt(
    params: { sessionId: string; prompt: ContentBlock[] },
    client: AgentContext,
  ): Promise<PromptResponse> {
    const session = this.getSession(params.sessionId);
    const promptText = toPromptText(params.prompt);
    if (session.promptInFlight) {
      throw new Error(`Session ${session.id} already has a prompt in progress`);
    }
    session.promptInFlight = true;
    session.abortController = new AbortController();

    try {
      const result = await this.serialized.run(() =>
        runWithWorkspace(session.cwd, async () => {
          // Read-before-edit state is process-wide; reset it at the start of
          // each serialized turn so one ACP session cannot authorize another.
          readFilesSet.clear();
          setCurrentSession(session.session);
          await services.chatHistory.initialize(session.session, true);
          services.chatHistory.setHistory(session.session.history);
          services.chatHistory.addUserMessage(promptText);

          const callbacks = this.createCallbacks(session, client);
          await streamChatResponse(
            services.chatHistory.getHistory(),
            session.model,
            session.llmApi,
            session.abortController!,
            callbacks,
          );

          session.session.history = services.chatHistory.getHistory();
          await session.notificationChain;
          return session.abortController!.signal.aborted;
        }),
      );

      return { stopReason: result ? "cancelled" : "end_turn" };
    } catch (error) {
      if (session.abortController?.signal.aborted || session.closed) {
        return { stopReason: "cancelled" };
      }
      logger.error("ACP prompt failed", error as Error);
      throw new Error("Continue failed to process the ACP prompt");
    } finally {
      session.pendingPermission = null;
      session.abortController = null;
      session.promptInFlight = false;
    }
  }

  cancel(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.abortController?.abort();
    if (session.pendingPermission) {
      toolPermissionManager.rejectRequest(session.pendingPermission.requestId);
      session.pendingPermission = null;
    }
  }

  attachConnection(connection: AgentConnection): void {
    connection.signal.addEventListener("abort", () => this.cleanup(), {
      once: true,
    });
  }

  cleanup(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const session of this.sessions.values()) {
      session.closed = true;
      session.abortController?.abort();
      if (session.pendingPermission) {
        toolPermissionManager.rejectRequest(
          session.pendingPermission.requestId,
        );
      }
      session.pendingPermission = null;
      session.notificationChain = Promise.resolve();
    }
    this.sessions.clear();
  }

  private createCallbacks(
    session: AcpSession,
    client: AgentContext,
  ): StreamCallbacks {
    const messageId = uuidv4();
    const notify = (update: SessionNotification["update"]) => {
      session.notificationChain = session.notificationChain
        .then(async () => {
          if (!this.closed && !session.closed) {
            await client.notify(methods.client.session.update, {
              sessionId: session.id,
              update,
            });
          }
        })
        .catch(() => {
          // A closed ACP connection cannot receive the queued notification.
        });
    };

    const toolUpdate = (
      toolCallId: string,
      name: string,
      status: ToolCallStatus,
      args?: unknown,
      output?: unknown,
    ) => {
      notify({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status,
        name,
        kind: toolKind(name),
        ...(args === undefined ? {} : { rawInput: args }),
        ...(output === undefined ? {} : { rawOutput: output }),
        locations: absoluteLocations(session.cwd, args),
      });
    };

    return {
      abortSignal: session.abortController?.signal,
      onContent: (content) =>
        notify({
          sessionUpdate: "agent_message_chunk",
          messageId,
          content: textContent(content),
        }),
      onToolStart: (name, args, toolCallId) => {
        const id = toolCallId || `tool-call-${uuidv4()}`;
        notify({
          sessionUpdate: "tool_call",
          toolCallId: id,
          title: name,
          name,
          kind: toolKind(name),
          status: "pending",
          rawInput: args,
          locations: absoluteLocations(session.cwd, args),
        });
      },
      onToolResult: (result, name, status, toolCallId) => {
        if (!toolCallId) {
          return;
        }
        toolUpdate(toolCallId, name, toolStatus(status), undefined, result);
      },
      onToolError: (error, name, toolCallId) => {
        if (!toolCallId) {
          return;
        }
        toolUpdate(toolCallId, name || "unknown", "failed", undefined, error);
      },
      onToolPermissionRequest: (
        name,
        args,
        requestId,
        _preview,
        toolCallId,
      ) => {
        const id = toolCallId || `tool-call-${uuidv4()}`;
        session.pendingPermission = { requestId, toolCallId: id };
        notify({
          sessionUpdate: "tool_call_update",
          toolCallId: id,
          status: "in_progress",
          name,
          kind: toolKind(name),
          rawInput: args,
          locations: absoluteLocations(session.cwd, args),
        });

        void client
          .request<RequestPermissionResponse, RequestPermissionRequest>(
            methods.client.session.requestPermission,
            {
              sessionId: session.id,
              toolCall: {
                toolCallId: id,
                title: name,
                name,
                kind: toolKind(name),
                status: "pending",
                rawInput: args,
                locations: absoluteLocations(session.cwd, args),
              },
              options: [
                {
                  optionId: "allow_once",
                  name: "Allow once",
                  kind: "allow_once",
                },
                {
                  optionId: "reject_once",
                  name: "Reject once",
                  kind: "reject_once",
                },
              ],
            },
            { cancellationSignal: session.abortController?.signal },
          )
          .then((response) => {
            if (session.pendingPermission?.requestId !== requestId) {
              return;
            }
            session.pendingPermission = null;
            if (
              response.outcome.outcome === "selected" &&
              response.outcome.optionId === "allow_once"
            ) {
              toolPermissionManager.approveRequest(requestId);
            } else {
              toolPermissionManager.rejectRequest(requestId);
            }
          })
          .catch(() => {
            if (session.pendingPermission?.requestId === requestId) {
              session.pendingPermission = null;
              toolPermissionManager.rejectRequest(requestId);
            }
          });
      },
    };
  }

  private getSession(sessionId: string): AcpSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed || this.closed) {
      throw new Error(`ACP session ${sessionId} not found`);
    }
    return session;
  }

  private version(): string {
    // Imported lazily by the CLI entry point in normal operation; keeping this
    // small avoids exposing package metadata or paths to ACP clients.
    return getVersion();
  }
}
