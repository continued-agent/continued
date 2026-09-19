/* eslint-disable max-lines */

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { promisify } from "node:util";

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { ParsedQs } from "qs";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { safeStderr, safeStdout } from "../init.js";
import { logger } from "../util/logger.js";
import { getVersion } from "../version.js";

import { RemoteError, remoteError } from "./errors.js";
import { isLoopbackHost } from "./options.js";
import {
  parseClientEvent,
  parseFileWriteBody,
  parsePagination,
  parsePermissionResponseBody,
  parsePromptBody,
  parseSessionCreateBody,
} from "./protocol.js";
import { RemoteRuntime } from "./runtime.js";
import {
  bearerTokenFromHeader,
  hasTokenQuery,
  isHostHeaderAllowed,
  isOriginAllowed,
  redactSecrets,
  resolveRemoteToken,
  tokenFromWebSocketHeaders,
  tokensEqual,
  truncate,
} from "./security.js";
import type {
  ClientEvent,
  ConnectionServerEvent,
  JsonValue,
  RemoteErrorCode,
  RemoteOptions,
  SequencedServerEvent,
} from "./types.js";

const MAX_BODY_BYTES = 1_048_576;
const MAX_WS_MESSAGE_BYTES = 1_048_576;
const MAX_FILE_BYTES = 5_242_880;
const MAX_WS_CONNECTIONS = 16;
const REQUEST_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const WS_HEARTBEAT_MS = 30_000;
const WS_RATE_WINDOW_MS = 10_000;
const WS_RATE_LIMIT = 100;
const HTTP_RATE_WINDOW_MS = 10_000;
const HTTP_RATE_LIMIT = 120;
const MAX_DIRECTORY_ENTRIES = 1_000;
const MAX_GIT_OUTPUT_BYTES = 1_048_576;

const execFileAsync = promisify(execFile);

interface RemoteRequest extends Request {
  remoteRequestId?: string;
}

interface WebSocketConnection {
  id: string;
  socket: WebSocket;
  subscriptions: Set<string>;
  messageTimes: number[];
  isAlive: boolean;
  messageTail: Promise<void>;
}

export interface RemoteServerHandle {
  readonly app: express.Express;
  readonly httpServer: HttpServer;
  readonly runtime: RemoteRuntime;
  readonly websocketServer: WebSocketServer;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

export interface RemoteServerStartOptions {
  installSignalHandlers?: boolean;
  runtime?: RemoteRuntime;
}

export async function startRemoteServer(
  options: RemoteOptions,
  optionsForTesting: RemoteServerStartOptions = {},
): Promise<RemoteServerHandle> {
  const token = resolveRemoteToken(options.authToken);
  const runtime = optionsForTesting.runtime ?? new RemoteRuntime(options);
  await runtime.initialize();

  if (token.generated && token.tokenFilePath) {
    safeStderr(`Remote auth token file: ${token.tokenFilePath}\n`);
  }
  if (!(await isLoopbackHost(options.host))) {
    safeStderr(
      `Warning: remote server is exposed on ${options.host}; use a reverse proxy with TLS and authentication before exposing it beyond a trusted network.\n`,
    );
  }

  const app = createRemoteApp(runtime, options, token.token, () => boundPort);
  const httpServer = createServer(app);
  httpServer.requestTimeout = REQUEST_TIMEOUT_MS;
  httpServer.headersTimeout = REQUEST_TIMEOUT_MS;
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_MESSAGE_BYTES,
  });
  const connections = new Map<string, WebSocketConnection>();
  let boundPort = options.port;
  let closing = false;
  let heartbeat: NodeJS.Timeout | null = null;
  let signalHandlers: { handleSignal: () => void } | undefined;

  httpServer.on("upgrade", (request, socket, head) => {
    const requestUrl = request.url;
    let pathname: string;
    try {
      pathname = new URL(requestUrl ?? "/", "http://localhost").pathname;
    } catch {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    if (pathname !== "/ws") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (
      hasTokenQuery(requestUrl) ||
      !isHostHeaderAllowed(request.headers.host, options.host, boundPort)
    ) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    const origin = headerValue(request.headers.origin);
    if (!isOriginAllowed(origin, options.corsOrigins)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    const providedToken = tokenFromWebSocketHeaders(
      request.headers.authorization,
      request.headers["sec-websocket-protocol"],
    );
    if (!providedToken || !tokensEqual(providedToken, token.token)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    if (connections.size >= MAX_WS_CONNECTIONS) {
      rejectUpgrade(socket, 1013, "Try Again Later");
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
    });
  });

  websocketServer.on("connection", (socket: WebSocket) => {
    const connection: WebSocketConnection = {
      id: randomUUID(),
      socket,
      subscriptions: new Set(),
      messageTimes: [],
      isAlive: true,
      messageTail: Promise.resolve(),
    };
    connections.set(connection.id, connection);
    socket.on("pong", () => {
      connection.isAlive = true;
    });
    socket.on("message", (raw) => {
      connection.messageTail = connection.messageTail
        .then(() => handleWebSocketMessage(connection, raw, runtime))
        .catch(() => undefined);
    });
    socket.on("close", () => {
      for (const sessionId of connection.subscriptions) {
        runtime.unsubscribe(sessionId, connection.id);
      }
      connection.subscriptions.clear();
      connections.delete(connection.id);
    });
    socket.on("error", () => {
      socket.close(1011, "Connection error");
    });
    sendConnectionEvent(socket, {
      v: 1,
      ts: new Date().toISOString(),
      type: "connected",
      connectionId: connection.id,
      capabilities: runtime.getInfo(getVersion()).capabilities,
    });
  });

  heartbeat = setInterval(() => {
    for (const connection of connections.values()) {
      if (!connection.isAlive) {
        connection.socket.terminate();
        continue;
      }
      connection.isAlive = false;
      connection.socket.ping();
    }
  }, WS_HEARTBEAT_MS);

  try {
    await listen(httpServer, options.host, options.port).then((port) => {
      boundPort = port;
    });
  } catch (error) {
    await runtime.shutdown();
    websocketServer.close();
    throw error;
  }

  const addressHost = formatUrlHost(options.host);
  const url = `http://${addressHost}:${boundPort}`;
  safeStdout(
    `${JSON.stringify({ type: "ready", protocol: 1, url, pid: process.pid })}\n`,
  );

  const close = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    const shutdownEvent: ConnectionServerEvent = {
      v: 1,
      ts: new Date().toISOString(),
      type: "server_shutdown",
      reason: "signal",
    };
    for (const connection of connections.values()) {
      sendConnectionEvent(connection.socket, shutdownEvent);
      connection.socket.close(1001, "Server shutting down");
    }
    const runtimeShutdown = runtime.shutdown().catch((error: unknown) => {
      logger.error(
        "Remote runtime shutdown failed",
        new Error(
          redactSecrets(
            error instanceof Error ? error.message : "unknown error",
          ),
        ),
      );
    });
    await withDeadline(runtimeShutdown, SHUTDOWN_TIMEOUT_MS);
    httpServer.closeIdleConnections?.();
    const httpClose = new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await withDeadline(httpClose, SHUTDOWN_TIMEOUT_MS);
    httpServer.closeAllConnections?.();
    websocketServer.close();
    connections.clear();
    if (signalHandlers) {
      process.removeListener("SIGINT", signalHandlers.handleSignal);
      process.removeListener("SIGTERM", signalHandlers.handleSignal);
      signalHandlers = undefined;
    }
  };

  if (optionsForTesting.installSignalHandlers !== false) {
    let signalCount = 0;
    const handleSignal = () => {
      signalCount += 1;
      if (signalCount > 1) {
        process.exit(0);
        return;
      }
      void close().then(() => process.exit(0));
    };
    signalHandlers = { handleSignal };
    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);
  }

  return {
    app,
    httpServer,
    runtime,
    websocketServer,
    port: boundPort,
    url,
    close,
  };
}

export function createRemoteApp(
  runtime: RemoteRuntime,
  options: RemoteOptions,
  expectedToken: string,
  getPort: () => number,
): express.Express {
  const app = express();
  const httpRateBuckets = new Map<
    string,
    { startedAt: number; count: number }
  >();
  app.disable("x-powered-by");
  app.use((req: RemoteRequest, res: Response, next: NextFunction) => {
    const requestId = requestIdFromHeader(req.headers["x-request-id"]);
    req.remoteRequestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Content-Type", "application/json");
    const origin = headerValue(req.headers.origin);
    if (origin) {
      if (!isOriginAllowed(origin, options.corsOrigins)) {
        sendError(
          res,
          req,
          remoteError("FORBIDDEN", "Origin not allowed", 403),
        );
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, If-Match, X-Request-Id",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
    }
    if (
      hasTokenQuery(req.originalUrl) ||
      !isHostHeaderAllowed(req.headers.host, options.host, getPort())
    ) {
      sendError(res, req, remoteError("FORBIDDEN", "Host not allowed", 403));
      return;
    }
    if (req.path === "/health") {
      next();
      return;
    }
    const provided = bearerTokenFromHeader(req.headers.authorization);
    if (!provided || !tokensEqual(provided, expectedToken)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      sendError(res, req, remoteError("UNAUTHORIZED", "Unauthorized", 401));
      return;
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    const now = Date.now();
    const clientKey = req.socket.remoteAddress ?? "unknown";
    const bucket = httpRateBuckets.get(clientKey);
    if (!bucket || now - bucket.startedAt >= HTTP_RATE_WINDOW_MS) {
      httpRateBuckets.set(clientKey, { startedAt: now, count: 1 });
    } else {
      bucket.count += 1;
      if (bucket.count > HTTP_RATE_LIMIT) {
        sendError(
          res,
          req,
          remoteError("RATE_LIMITED", "Rate limit exceeded", 429),
        );
        return;
      }
    }
    if (httpRateBuckets.size > 1024) {
      for (const [key, value] of httpRateBuckets) {
        if (now - value.startedAt >= HTTP_RATE_WINDOW_MS) {
          httpRateBuckets.delete(key);
        }
      }
    }
    next();
  });
  app.use(express.json({ limit: MAX_BODY_BYTES, strict: true }));

  app.get("/health", (req, res) => {
    assertNoUnknownQuery(req.query, []);
    res.status(200).json({ ok: true });
  });
  app.get("/info", (req, res) => {
    assertNoUnknownQuery(req.query, []);
    res.status(200).json(runtime.getInfo(getVersion()));
  });
  app.get(
    "/sessions",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, []);
      res.status(200).json({ sessions: await runtime.listSessionSummaries() });
    }),
  );
  app.post(
    "/sessions",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, []);
      const body = parseSessionCreateBody(req.body);
      const session = await runtime.createRemoteSession(body.workspaceId);
      res.status(201).json(session);
    }),
  );
  app.get(
    "/sessions/:id",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, []);
      const pagination = parsePagination({
        offset: queryString(req.query.offset),
        limit: queryString(req.query.limit),
      });
      res
        .status(200)
        .json(
          await runtime.getSessionSnapshot(
            req.params.id,
            pagination.offset,
            pagination.limit,
          ),
        );
    }),
  );
  app.delete(
    "/sessions/:id",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, []);
      await runtime.deleteSession(req.params.id);
      res.status(204).end();
    }),
  );
  app.post(
    "/sessions/:id/prompt",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, []);
      const body = parsePromptBody(req.body);
      const result = await runtime.startPrompt(
        req.params.id,
        body.content,
        body.clientMessageId,
      );
      res.status(202).json(result);
    }),
  );
  app.post(
    "/sessions/:id/cancel",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, []);
      await runtime.cancelSession(req.params.id);
      res.status(202).json({ cancelled: true });
    }),
  );

  app.get("/workspaces", (req, res) => {
    assertNoUnknownQuery(req.query, []);
    res.status(200).json({
      workspaces: [
        runtime.getWorkspace(runtime.getInfo(getVersion()).workspaces[0].id),
      ],
    });
  });
  app.get(
    "/workspaces/:id/files",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, ["path"]);
      const workspace = runtime.getWorkspace(req.params.id);
      const relative = queryString(req.query.path) ?? "";
      const directory = resolveWorkspacePath(
        workspaceRoot(options),
        relative,
        false,
        false,
      );
      const stat = fs.statSync(directory);
      if (!stat.isDirectory()) {
        throw remoteError("INVALID_REQUEST", "Path is not a directory", 400);
      }
      const entries = fs
        .readdirSync(directory, { withFileTypes: true })
        .slice(0, MAX_DIRECTORY_ENTRIES)
        .map((entry) => {
          const entryPath = path.join(directory, entry.name);
          let size: number | undefined;
          if (entry.isFile()) {
            try {
              size = fs.statSync(entryPath).size;
            } catch {
              size = undefined;
            }
          }
          return {
            name: entry.name,
            type: entry.isDirectory()
              ? "directory"
              : entry.isFile()
                ? "file"
                : "symlink",
            ...(size === undefined ? {} : { size }),
          };
        });
      res.status(200).json({
        workspaceId: workspace.id,
        path: relative,
        entries,
        truncated: fs.readdirSync(directory).length > MAX_DIRECTORY_ENTRIES,
      });
    }),
  );
  app.get(
    "/workspaces/:id/file",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, ["path"]);
      const workspace = runtime.getWorkspace(req.params.id);
      const relative = requiredQueryString(req.query.path, "path");
      const filePath = resolveWorkspacePath(
        workspaceRoot(options),
        relative,
        false,
        false,
      );
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        throw remoteError("FILE_NOT_FOUND", "File not found", 404);
      }
      if (stat.size > MAX_FILE_BYTES) {
        throw remoteError("PAYLOAD_TOO_LARGE", "File is too large", 413);
      }
      const content = fs.readFileSync(filePath, "utf8");
      const etag = etagFor(content);
      res.setHeader("ETag", etag);
      res.status(200).json({
        workspaceId: workspace.id,
        path: relative,
        content,
        etag,
        size: stat.size,
      });
    }),
  );
  app.put(
    "/workspaces/:id/file",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, ["path"]);
      const workspace = runtime.getWorkspace(req.params.id);
      if (workspace.readOnly) {
        throw remoteError("FORBIDDEN", "Workspace is read-only", 403);
      }
      const relative = requiredQueryString(req.query.path, "path");
      const body = parseFileWriteBody(req.body);
      const filePath = resolveWorkspacePath(
        workspaceRoot(options),
        relative,
        true,
        true,
      );
      const exists = fs.existsSync(filePath);
      if (exists) {
        const current = fs.readFileSync(filePath);
        const match = headerValue(req.headers["if-match"]);
        if (!match || match !== etagFor(current)) {
          throw remoteError(
            "PRECONDITION_FAILED",
            "If-Match does not match",
            412,
          );
        }
      }
      if (Buffer.byteLength(body.content, "utf8") > MAX_FILE_BYTES) {
        throw remoteError("PAYLOAD_TOO_LARGE", "File is too large", 413);
      }
      fs.writeFileSync(filePath, body.content, {
        encoding: "utf8",
        mode: 0o600,
      });
      const etag = etagFor(body.content);
      res.setHeader("ETag", etag);
      res.status(200).json({
        workspaceId: workspace.id,
        path: relative,
        etag,
        size: Buffer.byteLength(body.content, "utf8"),
      });
    }),
  );
  app.get(
    "/workspaces/:id/git/status",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, []);
      const workspace = runtime.getWorkspace(req.params.id);
      const result = await runGit(
        ["status", "--short", "--branch"],
        workspaceRoot(options),
      );
      res
        .status(200)
        .json({ workspaceId: workspace.id, status: result.stdout });
    }),
  );
  app.get(
    "/workspaces/:id/git/diff",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, ["path"]);
      const workspace = runtime.getWorkspace(req.params.id);
      const relative = queryString(req.query.path);
      const args = ["diff", "--no-ext-diff", "--unified=3", "--"];
      if (relative !== undefined) {
        resolveWorkspacePath(workspaceRoot(options), relative, false, false);
        args.push(relative);
      }
      const result = await runGit(args, workspaceRoot(options));
      res.status(200).json({
        workspaceId: workspace.id,
        path: relative ?? null,
        diff: result.stdout,
      });
    }),
  );
  app.post(
    "/permissions/:id/approve",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, []);
      const body = parsePermissionResponseBody(req.body);
      await runtime.resolvePermission(req.params.id, "approve", body.sessionId);
      res
        .status(200)
        .json({ permissionId: req.params.id, decision: "approve" });
    }),
  );
  app.post(
    "/permissions/:id/deny",
    asyncHandler(async (req, res) => {
      assertNoUnknownQuery(req.query, []);
      const body = parsePermissionResponseBody(req.body);
      await runtime.resolvePermission(req.params.id, "deny", body.sessionId);
      res.status(200).json({ permissionId: req.params.id, decision: "deny" });
    }),
  );

  app.use((req: RemoteRequest, _res, next) => {
    next(remoteError("NOT_FOUND", `Route not found: ${req.path}`, 404));
  });

  app.use(
    (
      error: unknown,
      req: RemoteRequest,
      res: Response,
      _next: NextFunction,
    ) => {
      if (res.headersSent) {
        return;
      }
      const remote =
        error instanceof RemoteError
          ? error
          : error instanceof SyntaxError
            ? remoteError("INVALID_REQUEST", "Invalid JSON body", 400)
            : isPayloadTooLarge(error)
              ? remoteError("PAYLOAD_TOO_LARGE", "Payload is too large", 413)
              : remoteError("INTERNAL_ERROR", "Internal server error", 500);
      if (!(error instanceof RemoteError)) {
        logger.error(
          "Remote request failed",
          new Error(redactSecrets(remote.message)),
        );
      }
      sendError(res, req, remote);
    },
  );
  return app;
}

async function handleWebSocketMessage(
  connection: WebSocketConnection,
  raw: RawData,
  runtime: RemoteRuntime,
): Promise<void> {
  const now = Date.now();
  connection.messageTimes = connection.messageTimes.filter(
    (timestamp) => now - timestamp < WS_RATE_WINDOW_MS,
  );
  connection.messageTimes.push(now);
  if (connection.messageTimes.length > WS_RATE_LIMIT) {
    sendConnectionError(
      connection.socket,
      undefined,
      "RATE_LIMITED",
      "Rate limit exceeded",
    );
    connection.socket.close(1008, "Rate limit exceeded");
    return;
  }
  const text = rawToString(raw);
  if (Buffer.byteLength(text, "utf8") > MAX_WS_MESSAGE_BYTES) {
    sendConnectionError(
      connection.socket,
      undefined,
      "PAYLOAD_TOO_LARGE",
      "Message is too large",
    );
    connection.socket.close(1009, "Message is too large");
    return;
  }
  let event: ClientEvent;
  try {
    event = parseClientEvent(JSON.parse(text));
  } catch (error) {
    const remote =
      error instanceof RemoteError
        ? error
        : remoteError("INVALID_REQUEST", "Invalid WebSocket message", 400);
    sendConnectionError(
      connection.socket,
      undefined,
      remote.code,
      remote.message,
    );
    connection.socket.close(
      remote.code === "UNSUPPORTED_PROTOCOL_VERSION" ? 1002 : 1008,
      "Invalid message",
    );
    return;
  }

  try {
    switch (event.type) {
      case "create_session": {
        const session = await runtime.createRemoteSession(event.workspaceId);
        sendAck(connection.socket, event.requestId, true, toJsonValue(session));
        return;
      }
      case "resume_session": {
        const session = await runtime.resumeSession(event.sessionId);
        sendAck(connection.socket, event.requestId, true, toJsonValue(session));
        return;
      }
      case "prompt": {
        const accepted = await runtime.startPrompt(
          event.sessionId,
          event.content,
          event.clientMessageId,
        );
        sendAck(
          connection.socket,
          event.requestId,
          true,
          toJsonValue(accepted),
        );
        return;
      }
      case "cancel":
        await runtime.cancelSession(event.sessionId);
        sendAck(connection.socket, event.requestId, true, { cancelled: true });
        return;
      case "permission_response":
        if (!connection.subscriptions.has(event.sessionId)) {
          throw remoteError(
            "PERMISSION_NOT_FOUND",
            "Permission not found",
            404,
          );
        }
        await runtime.resolvePermission(
          event.permissionId,
          event.decision,
          event.sessionId,
        );
        sendAck(connection.socket, event.requestId, true, {
          permissionId: event.permissionId,
          decision: event.decision,
        });
        return;
      case "subscribe": {
        runtime.subscribe(
          event.sessionId,
          {
            id: connection.id,
            send: (serverEvent) =>
              sendSequencedEvent(connection.socket, serverEvent),
            close: (code, reason) => connection.socket.close(code, reason),
          },
          event.afterSeq,
        );
        connection.subscriptions.add(event.sessionId);
        sendAck(connection.socket, event.requestId, true, {
          sessionId: event.sessionId,
          afterSeq: event.afterSeq ?? 0,
        });
        return;
      }
      case "unsubscribe":
        runtime.unsubscribe(event.sessionId, connection.id);
        connection.subscriptions.delete(event.sessionId);
        sendAck(connection.socket, event.requestId, true, {
          sessionId: event.sessionId,
        });
        return;
      case "ping":
        sendConnectionEvent(connection.socket, {
          v: 1,
          ts: new Date().toISOString(),
          type: "pong",
          ...(event.requestId ? { requestId: event.requestId } : {}),
        });
        return;
    }
  } catch (error) {
    const remote =
      error instanceof RemoteError
        ? error
        : remoteError("INTERNAL_ERROR", "Internal server error", 500);
    sendConnectionError(
      connection.socket,
      event.requestId,
      remote.code,
      remote.message,
    );
  }
}

function asyncHandler(
  handler: (
    req: RemoteRequest,
    res: Response,
    next: NextFunction,
  ) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req as RemoteRequest, res, next).catch(next);
  };
}

function sendError(
  res: Response,
  req: RemoteRequest,
  error: RemoteError,
): void {
  const requestId = req.remoteRequestId ?? requestIdFromHeader(undefined);
  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      requestId,
    },
  });
}

function sendConnectionEvent(
  socket: WebSocket,
  event: ConnectionServerEvent,
): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function sendSequencedEvent(
  socket: WebSocket,
  event: SequencedServerEvent,
): boolean {
  if (socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  if (socket.bufferedAmount > 2 * MAX_WS_MESSAGE_BYTES) {
    return false;
  }
  socket.send(JSON.stringify(event));
  return true;
}

function sendAck(
  socket: WebSocket,
  requestId: string | undefined,
  ok: true,
  data: JsonValue,
): void {
  sendConnectionEvent(socket, {
    v: 1,
    ts: new Date().toISOString(),
    type: "ack",
    ...(requestId ? { requestId } : {}),
    ok,
    data,
  });
}

function sendConnectionError(
  socket: WebSocket,
  requestId: string | undefined,
  code: RemoteErrorCode,
  message: string,
): void {
  sendConnectionEvent(socket, {
    v: 1,
    ts: new Date().toISOString(),
    type: "error",
    ...(requestId ? { requestId } : {}),
    ok: false,
    error: { code, message },
  });
}

function rawToString(raw: RawData): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  return raw.toString("utf8");
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function listen(
  server: HttpServer,
  host: string,
  port: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to determine remote server port"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function requestIdFromHeader(value: string | string[] | undefined): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate &&
    candidate.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(candidate)
    ? candidate
    : randomUUID();
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function queryString(value: ParsedQs[string] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredQueryString(
  value: ParsedQs[string] | undefined,
  field: string,
): string {
  const result = queryString(value);
  if (!result) {
    throw remoteError(
      "INVALID_REQUEST",
      `Missing query parameter: ${field}`,
      400,
    );
  }
  return result;
}

function assertNoUnknownQuery(
  query: ParsedQs,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(query)) {
    if (!allowedSet.has(key)) {
      throw remoteError(
        "INVALID_REQUEST",
        `Unknown query parameter: ${key}`,
        400,
      );
    }
  }
}

function workspaceRoot(options: RemoteOptions): string {
  return options.workspace;
}

function resolveWorkspacePath(
  workspaceRootPath: string,
  inputPath: string,
  allowMissing: boolean,
  forWrite: boolean,
): string {
  if (
    inputPath.includes("\0") ||
    inputPath.includes("\\") ||
    inputPath.includes("%") ||
    path.posix.isAbsolute(inputPath) ||
    path.win32.isAbsolute(inputPath) ||
    /^[A-Za-z]:/.test(inputPath)
  ) {
    throw remoteError(
      "PATH_OUTSIDE_WORKSPACE",
      "Path is outside workspace",
      403,
    );
  }
  const parts = inputPath.split("/");
  if (parts.some((part) => part === "..")) {
    throw remoteError(
      "PATH_OUTSIDE_WORKSPACE",
      "Path is outside workspace",
      403,
    );
  }
  if (forWrite && parts.some((part) => part === ".git")) {
    throw remoteError("FORBIDDEN", "Writing under .git is forbidden", 403);
  }
  const root = fs.realpathSync(workspaceRootPath);
  const candidate = path.resolve(root, inputPath || ".");
  let canonical: string;
  try {
    canonical = fs.realpathSync(candidate);
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw remoteError("FILE_NOT_FOUND", "File not found", 404);
    }
    const parent = fs.realpathSync(path.dirname(candidate));
    canonical = path.join(parent, path.basename(candidate));
  }
  const relative = path.relative(root, canonical);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw remoteError(
      "PATH_OUTSIDE_WORKSPACE",
      "Path is outside workspace",
      403,
    );
  }
  if (forWrite) {
    const canonicalParts = path.relative(root, canonical).split(path.sep);
    if (canonicalParts.includes(".git")) {
      throw remoteError("FORBIDDEN", "Writing under .git is forbidden", 403);
    }
    const parent = fs.realpathSync(path.dirname(canonical));
    const parentRelative = path.relative(root, parent);
    if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) {
      throw remoteError(
        "PATH_OUTSIDE_WORKSPACE",
        "Path is outside workspace",
        403,
      );
    }
  }
  return canonical;
}

function etagFor(value: string | Buffer): string {
  return `"${createHash("sha256").update(value).digest("hex")}"`;
}

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: REQUEST_TIMEOUT_MS,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
    });
    return {
      stdout: truncate(String(result.stdout), MAX_GIT_OUTPUT_BYTES),
      stderr: truncate(String(result.stderr), MAX_GIT_OUTPUT_BYTES),
    };
  } catch (error) {
    const details = error as {
      stdout?: string;
      stderr?: string;
      code?: string | number;
    };
    if (details.code === 128 || details.code === "128") {
      throw remoteError(
        "INVALID_REQUEST",
        "Workspace is not a Git repository",
        400,
      );
    }
    logger.error(
      "Remote Git request failed",
      new Error(redactSecrets("git request failed")),
    );
    throw remoteError("INTERNAL_ERROR", "Git request failed", 500);
  }
}

function toJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return "[UNSERIALIZABLE]";
  }
}

function isPayloadTooLarge(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  );
}

function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function withDeadline(
  operation: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timeout: NodeJS.Timeout;
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([operation, deadline]);
  clearTimeout(timeout!);
}
