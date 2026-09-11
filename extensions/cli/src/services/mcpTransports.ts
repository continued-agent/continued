import { Agent as HttpsAgent } from "https";

import { assertPublicUrl, publicDnsLookup } from "@continuedev/fetch";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  HttpMcpServer,
  SseMcpServer,
  StdioMcpServer,
} from "node_modules/@continuedev/config-yaml/dist/schemas/mcp/index.js";

import { MCPConnectionInfo } from "./types.js";

export const MCP_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "USERPROFILE",
  "LOGNAME",
  "USERNAME",
  "TMPDIR",
  "TEMP",
  "TMP",
] as const;

/** Maximum bytes of stderr we retain per connection for error reporting. */
const MAX_STDERR_BUFFER_BYTES = 64 * 1024;

const ALLOW_PRIVATE_MCP_SERVERS =
  process.env.CONTINUE_ALLOW_PRIVATE_MCP_SERVERS === "true";

/**
 * Validate a network MCP server URL (scheme, credentials, DNS) before any
 * connection is attempted. Mirrors the core's MCPConnection checks so the CLI
 * gets the same SSRF protection.
 */
export async function assertSafeMcpServerUrl(rawUrl: string): Promise<URL> {
  if (ALLOW_PRIVATE_MCP_SERVERS) {
    return new URL(rawUrl);
  }
  return await assertPublicUrl(rawUrl);
}

export function buildMcpEnvironment(
  configuredEnv?: Record<string, string>,
): Record<string, string> {
  const inheritedEnv = Object.fromEntries(
    MCP_ENV_ALLOWLIST.filter((key) => process.env[key] !== undefined).map(
      (key) => [key, process.env[key] as string],
    ),
  );
  return {
    ...inheritedEnv,
    ...configuredEnv,
  };
}

export async function constructSseTransport(
  serverConfig: SseMcpServer,
  apiKey: string | undefined,
): Promise<SSEClientTransport> {
  const url = await assertSafeMcpServerUrl(serverConfig.url);
  const sseAgent =
    serverConfig.requestOptions?.verifySsl === false
      ? new HttpsAgent({ rejectUnauthorized: false })
      : undefined;

  const headers = {
    ...serverConfig.requestOptions?.headers,
    ...(apiKey && {
      Authorization: `Bearer ${apiKey}`,
    }),
  };

  return new SSEClientTransport(url, {
    eventSourceInit: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: {
            ...init?.headers,
            ...headers,
          },
          ...(sseAgent && { agent: sseAgent }),
          ...(!ALLOW_PRIVATE_MCP_SERVERS && { lookup: publicDnsLookup }),
        }),
    },
    requestInit: {
      headers,
      ...(sseAgent && { agent: sseAgent }),
      ...(!ALLOW_PRIVATE_MCP_SERVERS && { lookup: publicDnsLookup }),
    },
  });
}

export async function constructHttpTransport(
  serverConfig: HttpMcpServer,
  apiKey: string | undefined,
): Promise<StreamableHTTPClientTransport> {
  const url = await assertSafeMcpServerUrl(serverConfig.url);
  const streamableAgent =
    serverConfig.requestOptions?.verifySsl === false
      ? new HttpsAgent({ rejectUnauthorized: false })
      : undefined;

  const headers = {
    ...serverConfig.requestOptions?.headers,
    ...(apiKey && {
      Authorization: `Bearer ${apiKey}`,
    }),
  };

  return new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers,
      ...(streamableAgent && { agent: streamableAgent }),
      ...(!ALLOW_PRIVATE_MCP_SERVERS && { lookup: publicDnsLookup }),
    },
  });
}

export function constructStdioTransport(
  serverConfig: StdioMcpServer,
  connection: MCPConnectionInfo,
): StdioClientTransport {
  const env = buildMcpEnvironment(serverConfig.env);

  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args || [],
    env,
    cwd: serverConfig.cwd,
    stderr: "pipe",
  });

  const stderrStream = transport.stderr;
  if (stderrStream) {
    let bufferedBytes = 0;
    let truncated = false;
    stderrStream.on("data", (data: Buffer) => {
      if (truncated) {
        return;
      }
      const stderrOutput = data.toString().trim();
      if (!stderrOutput) {
        return;
      }
      bufferedBytes += Buffer.byteLength(stderrOutput);
      if (bufferedBytes > MAX_STDERR_BUFFER_BYTES) {
        const remaining = Math.max(
          0,
          MAX_STDERR_BUFFER_BYTES -
            (bufferedBytes - Buffer.byteLength(stderrOutput)),
        );
        connection.warnings.push(
          `${stderrOutput.slice(0, remaining)}\n[stderr truncated]`,
        );
        truncated = true;
        return;
      }
      connection.warnings.push(stderrOutput);
    });
  }

  return transport;
}
