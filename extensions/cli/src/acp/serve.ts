import { Readable } from "node:stream";

import { agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";

import { createRawStdoutStream } from "../init.js";

import { AcpRuntime, type AcpOptions } from "./runtime.js";

export async function runAcp(options: AcpOptions): Promise<void> {
  const runtime = new AcpRuntime(options);
  await runtime.initialize();

  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(createRawStdoutStream(), input);
  const app = agent({ name: "continue" })
    .onRequest(methods.agent.initialize, (ctx) =>
      runtime.initializeRequest(ctx.params.protocolVersion),
    )
    .onRequest(methods.agent.session.new, (ctx) =>
      runtime.newSession(ctx.params),
    )
    .onRequest(methods.agent.session.prompt, (ctx) =>
      runtime.prompt(ctx.params, ctx.client),
    )
    .onNotification(methods.agent.session.cancel, (ctx) =>
      runtime.cancel(ctx.params.sessionId),
    );

  const connection = app.connect(stream);
  runtime.attachConnection(connection);

  const shutdown = () => {
    runtime.cleanup();
    connection.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await connection.closed;
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    runtime.cleanup();
  }
}
