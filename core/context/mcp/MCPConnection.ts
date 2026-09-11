import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { homedir } from "os";
import { fileURLToPath } from "url";

import {
  decodeSecretLocation,
  getTemplateVariables,
} from "@continuedev/config-yaml";
import {
  assertPublicUrl,
  isPrivateNetworkAddress,
  publicDnsLookup,
} from "@continuedev/fetch";
import {
  SSEClientTransport,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import { Agent as HttpsAgent } from "https";
import {
  IDE,
  InternalMcpOptions,
  InternalSseMcpOptions,
  InternalStdioMcpOptions,
  InternalStreamableHttpMcpOptions,
  InternalWebsocketMcpOptions,
  MCPConnectionStatus,
  MCPPrompt,
  MCPResource,
  MCPResourceTemplate,
  MCPServerStatus,
  MCPTool,
} from "../..";
import { resolveRelativePathInDir } from "../../util/ideUtils";
import { getEnvPathFromUserShell } from "../../util/shellPath";
import { getOauthToken } from "./MCPOauth";

const DEFAULT_MCP_TIMEOUT = 20_000; // 20 seconds

/** Maximum bytes of stderr we retain per connection for error reporting. */
const MAX_STDERR_BUFFER_BYTES = 64 * 1024;

/**
 * Validates a network MCP server URL before a connection is attempted.
 *
 * MCP server URLs come from config files (including workspace `.continue`
 * configs that may be supplied by a cloned repository), so they are
 * attacker-influenced. We reject:
 *  - unsupported schemes (only http/https/ws/wss are allowed)
 *  - URLs with embedded credentials (userinfo)
 *  - destinations on loopback, RFC1918, link-local (incl. cloud metadata
 *    169.254.169.254) or otherwise private networks, including after DNS
 *    resolution — unless the user explicitly opts in via
 *    CONTINUE_ALLOW_PRIVATE_MCP_SERVERS=true (needed for local dev servers).
 */
function assertSafeMcpServerUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid MCP server URL: ${rawUrl}`);
  }

  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error(`Unsupported MCP server URL scheme: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new Error(
      "MCP server URLs with embedded credentials are not allowed",
    );
  }

  if (process.env.CONTINUE_ALLOW_PRIVATE_MCP_SERVERS === "true") {
    return url;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isPrivateNetworkAddress(hostname)
  ) {
    throw new Error(
      `MCP server URL resolves to a private or local network address (${hostname}). ` +
        `Set CONTINUE_ALLOW_PRIVATE_MCP_SERVERS=true to allow local/dev MCP servers.`,
    );
  }

  return url;
}

/**
 * Validates a network MCP server URL and resolves its hostname up front. The
 * returned URL is only useful for the hostname check; the actual transports
 * pin DNS resolution with {@link publicDnsLookup} so a DNS answer cannot
 * change between validation and socket creation (DNS rebinding).
 */
async function assertSafeMcpServerUrlWithDns(rawUrl: string): Promise<URL> {
  const url = assertSafeMcpServerUrl(rawUrl);
  if (process.env.CONTINUE_ALLOW_PRIVATE_MCP_SERVERS === "true") {
    return url;
  }
  // Reuse the fetch package's public-only DNS validation (hostname resolution
  // + blocklist) so MCP transports get the same guarantees as the URL
  // fetcher.
  await assertPublicUrl(url);
  return url;
}

/** Header names whose values must never be exposed outside the core. */
const SENSITIVE_HEADER_NAMES = [
  "authorization",
  "x-api-key",
  "x-goog-api-key",
  "proxy-authorization",
  "cookie",
];

function redactSensitiveHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = SENSITIVE_HEADER_NAMES.includes(key.toLowerCase())
      ? "<redacted>"
      : value;
  }
  return redacted;
}

// Commands that are batch scripts on Windows and need cmd.exe to execute
const WINDOWS_BATCH_COMMANDS = [
  "npx",
  "uv",
  "uvx",
  "pnpx",
  "dlx",
  "nx",
  "bunx",
];

const COMMONS_ENV_VARS = ["HOME", "USER", "USERPROFILE", "LOGNAME", "USERNAME"];

function is401Error(error: unknown) {
  return (
    (error instanceof SseError && error.code === 401) ||
    (error instanceof Error && error.message.includes("401")) ||
    (error instanceof Error && error.message.includes("Unauthorized"))
  );
}

export type MCPExtras = {
  ide: IDE;
};

class MCPConnection {
  public client: Client;
  public abortController: AbortController;
  public status: MCPConnectionStatus = "not-connected";
  public isProtectedResource = false;
  public errors: string[] = [];
  public infos: string[] = [];
  public prompts: MCPPrompt[] = [];
  public tools: MCPTool[] = [];
  public resources: MCPResource[] = [];
  public resourceTemplates: MCPResourceTemplate[] = [];
  private transport: Transport;
  private connectionPromise: Promise<unknown> | null = null;
  private stdioOutput: { stdout: string; stderr: string } = {
    stdout: "",
    stderr: "",
  };
  private _requiresApproval = false;

  constructor(
    public options: InternalMcpOptions,
    public extras?: MCPExtras,
  ) {
    // Don't construct transport in constructor to avoid blocking
    this.transport = {} as Transport; // Will be set in connectClient

    this.client = new Client(
      {
        name: "continue-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    this.abortController = new AbortController();
  }

  async disconnect(disable = false) {
    this.abortController.abort();
    await this.client.close();
    await this.transport.close();
    this.status = disable ? "disabled" : "not-connected";
    this._requiresApproval = false;
  }

  setRequiresApproval(requires: boolean) {
    this._requiresApproval = requires;
  }

  getStatus(): MCPServerStatus {
    const { requestOptions, ...rest } = this.options;
    // `apiKey` only exists on the network transports; stdio options don't have it.
    const apiKey = "apiKey" in this.options ? this.options.apiKey : undefined;
    // Never ship transport credentials (Authorization header, apiKey) to the
    // frontend via the status model — they would surface in logs/dumps.
    const sanitizedOptions = {
      ...rest,
      ...(apiKey ? { apiKey: "<redacted>" } : {}),
      requestOptions: requestOptions
        ? {
            ...requestOptions,
            headers: requestOptions.headers
              ? redactSensitiveHeaders(requestOptions.headers)
              : undefined,
          }
        : undefined,
    };
    return {
      ...sanitizedOptions,
      errors: this.errors,
      infos: this.infos,
      prompts: this.prompts,
      resources: this.resources,
      resourceTemplates: this.resourceTemplates,
      tools: this.tools,
      status: this.status,
      isProtectedResource: this.isProtectedResource,
      requiresApproval: this._requiresApproval,
    };
  }

  async connectClient(forceRefresh: boolean, externalSignal: AbortSignal) {
    if (this.status === "disabled") {
      return;
    }
    if (!forceRefresh) {
      // Already connected
      if (this.status === "connected") {
        return;
      }

      // Connection is already in progress; wait for it to complete
      if (this.connectionPromise) {
        await this.connectionPromise;
        return;
      }
    }

    this.status = "connecting";
    this.tools = [];
    this.prompts = [];
    this.resources = [];
    this.resourceTemplates = [];
    this.errors = [];
    this.infos = [];
    this.stdioOutput = { stdout: "", stderr: "" };
    this._requiresApproval = false;

    this.abortController.abort();
    this.abortController = new AbortController();

    // currently support oauth for sse transports only
    if (this.options.type === "sse") {
      if (!this.options.requestOptions) {
        this.options.requestOptions = {
          headers: {},
        };
      }
      const accessToken = await getOauthToken(
        this.options.url,
        this.extras?.ide!,
      );
      if (accessToken) {
        this.isProtectedResource = true;
        this.options.requestOptions.headers = {
          ...this.options.requestOptions.headers,
          Authorization: `Bearer ${accessToken}`,
        };
      }
    }

    const vars = getTemplateVariables(JSON.stringify(this.options));
    const unrendered = vars.map((v) => {
      const stripped = v.replace("secrets.", "");
      try {
        return decodeSecretLocation(stripped).secretName;
      } catch {
        return stripped;
      }
    });

    if (unrendered.length > 0) {
      this.errors.push(
        `${this.options.name} MCP Server has unresolved secrets: ${unrendered.join(", ")}.
For personal use you can set the secret in the hub at https://continue.dev/settings/secrets.
Org-level secrets can only be used for MCP by Background Agents (https://docs.continue.dev/hub/agents/overview) when \"Include in Env\" is enabled.`,
      );
    }

    this.connectionPromise = Promise.race([
      // If aborted by a refresh or other, cancel and don't do anything
      new Promise((resolve) => {
        externalSignal.addEventListener("abort", () => {
          resolve(undefined);
        });
      }),
      new Promise((resolve) => {
        this.abortController.signal.addEventListener("abort", () => {
          resolve(undefined);
        });
      }),
      (async () => {
        const timeoutController = new AbortController();
        const connectionTimeout = setTimeout(
          () => timeoutController.abort(),
          this.options.timeout ?? DEFAULT_MCP_TIMEOUT,
        );

        try {
          await Promise.race([
            new Promise((_, reject) => {
              timeoutController.signal.addEventListener("abort", () => {
                reject(new Error("Connection timed out"));
              });
            }),
            (async () => {
              if ("command" in this.options) {
                // STDIO: no need to check type, just if command is present
                const transport = await this.constructStdioTransport(
                  this.options,
                );
                try {
                  await this.client.connect(transport, {});
                  this.transport = transport;
                } catch (error) {
                  // Allow the case where for whatever reason is already connected
                  if (
                    error instanceof Error &&
                    error.message.startsWith(
                      "StdioClientTransport already started",
                    )
                  ) {
                    await this.client.close();
                    await this.client.connect(transport);
                    this.transport = transport;
                  } else {
                    throw error;
                  }
                }
              } else {
                // SSE/HTTP: if type isn't explicit: try http and fall back to sse
                if (this.options.type === "sse") {
                  const transport = await this.constructSseTransport(
                    this.options,
                  );
                  await this.client.connect(transport, {});
                  this.transport = transport;
                } else if (this.options.type === "streamable-http") {
                  const transport = await this.constructHttpTransport(
                    this.options,
                  );
                  await this.client.connect(transport, {});
                  this.transport = transport;
                } else if (this.options.type === "websocket") {
                  const transport = await this.constructWebsocketTransport(
                    this.options,
                  );
                  await this.client.connect(transport, {});
                  this.transport = transport;
                } else if (this.options.type) {
                  throw new Error(
                    `Unsupported transport type: ${this.options.type}`,
                  );
                } else {
                  try {
                    const transport = await this.constructHttpTransport({
                      ...this.options,
                      type: "streamable-http",
                    });
                    await this.client.connect(transport, {});
                    this.transport = transport;
                  } catch (e) {
                    try {
                      const transport = await this.constructSseTransport({
                        ...this.options,
                        type: "sse",
                      });
                      await this.client.connect(transport, {});
                      this.transport = transport;
                    } catch (e) {
                      throw new Error(
                        `MCP config with URL and no type specified failed both SSE and HTTP connection: ${e instanceof Error ? e.message : String(e)}`,
                      );
                    }
                  }
                }
              }

              // TODO register server notification handlers
              // this.client.transport?.onmessage(msg => console.log())
              // this.client.setNotificationHandler(, notification => {
              //   console.log(notification)
              // })
              const capabilities = this.client.getServerCapabilities();

              // Resources <—> Context Provider
              if (capabilities?.resources) {
                try {
                  const { resources } = await this.client.listResources(
                    {},
                    { signal: timeoutController.signal },
                  );
                  this.resources = resources;
                } catch (e) {
                  let errorMessage = `Error loading resources for MCP Server ${this.options.name}`;
                  if (e instanceof Error) {
                    errorMessage += `: ${e.message}`;
                  }
                  this.errors.push(errorMessage);
                }

                // Resource templates
                try {
                  const { resourceTemplates } =
                    await this.client.listResourceTemplates(
                      {},
                      { signal: timeoutController.signal },
                    );

                  this.resourceTemplates = resourceTemplates;
                } catch (e) {
                  let errorMessage = `Error loading resource templates for MCP Server ${this.options.name}`;
                  if (e instanceof Error) {
                    errorMessage += `: ${e.message}`;
                  }
                  this.errors.push(errorMessage);
                }
              }

              // Tools <—> Tools
              if (capabilities?.tools) {
                try {
                  const { tools } = await this.client.listTools(
                    {},
                    { signal: timeoutController.signal },
                  );
                  this.tools = tools;
                } catch (e) {
                  let errorMessage = `Error loading tools for MCP Server ${this.options.name}`;
                  if (e instanceof Error) {
                    errorMessage += `: ${e.message}`;
                  }
                  this.errors.push(errorMessage);
                }
              }

              // Prompts <—> Slash commands
              if (capabilities?.prompts) {
                try {
                  const { prompts } = await this.client.listPrompts(
                    {},
                    { signal: timeoutController.signal },
                  );
                  this.prompts = prompts;
                } catch (e) {
                  let errorMessage = `Error loading prompts for MCP Server ${this.options.name}`;
                  if (e instanceof Error) {
                    errorMessage += `: ${e.message}`;
                  }
                  this.errors.push(errorMessage);
                }
              }

              this.status = "connected";
            })(),
          ]);
        } catch (error) {
          // Otherwise it's a connection error
          let errorMessage = `Failed to connect to "${this.options.name}"\n`;
          if (error instanceof Error) {
            const msg = error.message.toLowerCase();
            if (msg.includes("spawn") && msg.includes("enoent")) {
              const command = msg.split(" ")[1];
              errorMessage += `Error: command "${command}" not found. To use this MCP server, install the ${command} CLI.`;
              if (["uv", "uvx"].includes(command)) {
                this.infos.push(
                  'Please install uv by following the installation guide: <a href="https://docs.astral.sh/uv/getting-started/installation/">https://docs.astral.sh/uv/getting-started/installation/</a>',
                );
              }
              if (["node", "npx"].includes(command)) {
                this.infos.push(
                  'Please install npx by following the installation guide: <a href="https://docs.npmjs.com/downloading-and-installing-node-js-and-npm">https://docs.npmjs.com/downloading-and-installing-node-js-and-npm</a>',
                );
              }
            } else {
              errorMessage += "Error: " + error.message;
            }
          }

          if (is401Error(error)) {
            this.isProtectedResource = true;
          }

          // Include stdio output if available for stdio transport
          if (
            this.options.type === "stdio" &&
            (this.stdioOutput.stdout || this.stdioOutput.stderr)
          ) {
            errorMessage += "\n\nProcess output:";
            if (this.stdioOutput.stdout) {
              errorMessage += `\nSTDOUT:\n${this.stdioOutput.stdout}`;
            }
            if (this.stdioOutput.stderr) {
              errorMessage += `\nSTDERR:\n${this.stdioOutput.stderr}`;
            }
          }

          this.status = "error";
          this.errors.push(errorMessage);
        } finally {
          this.connectionPromise = null;
          clearTimeout(connectionTimeout);
        }
      })(),
    ]);

    await this.connectionPromise;
  }

  /**
   * Resolves the command and arguments for the current platform
   * On Windows, batch script commands need to be executed via cmd.exe
   * UNLESS we're connected to a WSL remote (where Linux commands should run)
   * @param originalCommand The original command
   * @param originalArgs The original command arguments
   * @returns An object with the resolved command and arguments
   */
  private async resolveCommandForPlatform(
    originalCommand: string,
    originalArgs: string[],
  ): Promise<{ command: string; args: string[] }> {
    // Check if we're on Windows host connected to WSL remote
    const ideInfo = await this.extras?.ide?.getIdeInfo();
    const isWindowsHostWithWslRemote =
      process.platform === "win32" && ideInfo?.remoteName === "wsl";

    // If not on Windows, or connected to WSL, or not a batch command, return as-is
    if (
      process.platform !== "win32" ||
      isWindowsHostWithWslRemote ||
      !WINDOWS_BATCH_COMMANDS.includes(originalCommand)
    ) {
      return { command: originalCommand, args: originalArgs };
    }

    // On Windows (local), we need to execute batch commands via cmd.exe
    // Format: cmd.exe /c command [args]
    return {
      command: "cmd.exe",
      args: ["/c", originalCommand, ...originalArgs],
    };
  }

  /**
   * Resolves the current working directory of the current workspace.
   * @param cwd The cwd parameter provided by user.
   * @returns Current working directory (user-provided cwd or workspace root).
   */
  private async resolveCwd(cwd?: string) {
    if (!cwd) {
      return this.resolveWorkspaceCwd(undefined);
    }

    if (cwd.startsWith("file://")) {
      return fileURLToPath(cwd);
    }

    // Return cwd if cwd is an absolute path.
    if (cwd.charAt(0) === "/") {
      return cwd;
    }

    return this.resolveWorkspaceCwd(cwd);
  }

  private async resolveWorkspaceCwd(cwd: string | undefined) {
    const IDE = this.extras?.ide;
    if (IDE) {
      const target = cwd ?? ".";
      const resolved = await resolveRelativePathInDir(target, IDE);
      if (resolved) {
        if (resolved.startsWith("file://")) {
          return fileURLToPath(resolved);
        }
        // Remote URIs (e.g. vscode-remote://ssh-remote+host/path) cannot be
        // used as a local cwd for child_process.spawn(). When the extension
        // runs in the Local Extension Host on Windows while connected to a
        // remote workspace, fall back to the user's home directory.
        if (resolved.includes("://")) {
          return homedir();
        }
        return resolved;
      }
      return resolved;
    }
    return cwd;
  }

  private async constructWebsocketTransport(
    options: InternalWebsocketMcpOptions,
  ): Promise<WebSocketClientTransport> {
    // The SDK's WebSocket transport uses the global WebSocket (undici), which
    // does not accept a custom DNS lookup. Resolve and validate the hostname
    // immediately before connecting so the validation-to-connect window is as
    // small as possible.
    const url = await assertSafeMcpServerUrlWithDns(options.url);
    return new WebSocketClientTransport(url);
  }

  private async constructSseTransport(
    options: InternalSseMcpOptions,
  ): Promise<SSEClientTransport> {
    const url = await assertSafeMcpServerUrlWithDns(options.url);
    const sseAgent =
      options.requestOptions?.verifySsl === false
        ? new HttpsAgent({ rejectUnauthorized: false })
        : undefined;

    // Merge apiKey into headers if provided
    const headers = {
      ...options.requestOptions?.headers,
      ...(options.apiKey && { Authorization: `Bearer ${options.apiKey}` }),
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
            // Reuse the fetch package's public-only DNS lookup so the
            // connection cannot be re-pointed at a private address.
            ...(process.env.CONTINUE_ALLOW_PRIVATE_MCP_SERVERS !== "true" && {
              lookup: publicDnsLookup,
            }),
          }),
      },
      requestInit: {
        headers,
        ...(sseAgent && { agent: sseAgent }),
        ...(process.env.CONTINUE_ALLOW_PRIVATE_MCP_SERVERS !== "true" && {
          lookup: publicDnsLookup,
        }),
      },
    });
  }

  private async constructHttpTransport(
    options: InternalStreamableHttpMcpOptions,
  ): Promise<StreamableHTTPClientTransport> {
    const url = await assertSafeMcpServerUrlWithDns(options.url);
    const { requestOptions } = options;
    const streamableAgent =
      requestOptions?.verifySsl === false
        ? new HttpsAgent({ rejectUnauthorized: false })
        : undefined;

    // Merge apiKey into headers if provided
    const headers = {
      ...requestOptions?.headers,
      ...(options.apiKey && { Authorization: `Bearer ${options.apiKey}` }),
    };

    return new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers,
        ...(streamableAgent && { agent: streamableAgent }),
        ...(process.env.CONTINUE_ALLOW_PRIVATE_MCP_SERVERS !== "true" && {
          lookup: publicDnsLookup,
        }),
      },
    });
  }

  private async constructStdioTransport(
    options: InternalStdioMcpOptions,
  ): Promise<StdioClientTransport> {
    const commonEnvVars: Record<string, string> = Object.fromEntries(
      COMMONS_ENV_VARS.filter((key) => process.env[key] !== undefined).map(
        (key) => [key, process.env[key] as string],
      ),
    );

    const env = {
      ...commonEnvVars,
      ...(options.env ?? {}),
    };

    if (process.env.PATH !== undefined) {
      // Set the initial PATH from process.env
      env.PATH = process.env.PATH;

      // For non-Windows platforms or WSL remotes, try to get the PATH from user shell
      const ideInfo = await this.extras?.ide?.getIdeInfo();
      const isWindowsHostWithWslRemote =
        process.platform === "win32" && ideInfo?.remoteName === "wsl";
      if (process.platform !== "win32" || isWindowsHostWithWslRemote) {
        try {
          const shellEnvPath = await getEnvPathFromUserShell(
            ideInfo?.remoteName,
          );
          if (shellEnvPath && shellEnvPath !== process.env.PATH) {
            env.PATH = shellEnvPath;
          }
        } catch (err) {
          console.error("Error getting PATH:", err);
        }
      }
    }

    const { command, args } = await this.resolveCommandForPlatform(
      options.command,
      options.args || [],
    );

    const cwd = await this.resolveCwd(options.cwd);

    const transport = new StdioClientTransport({
      command,
      args,
      env,
      cwd,
      stderr: "pipe",
    });

    // Capture stdio output for better error reporting. Bound the buffer so a
    // noisy or hostile MCP server cannot grow memory without limit.
    transport.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (
        this.stdioOutput.stderr.length + chunk.length >
        MAX_STDERR_BUFFER_BYTES
      ) {
        const remaining =
          MAX_STDERR_BUFFER_BYTES - this.stdioOutput.stderr.length;
        if (remaining > 0) {
          this.stdioOutput.stderr += chunk.slice(0, remaining);
        }
        this.stdioOutput.stderr += "\n[stderr truncated]";
      } else {
        this.stdioOutput.stderr += chunk;
      }
    });

    return transport;
  }

  async getResource(uri: string) {
    return await this.client.readResource(
      { uri },
      {
        timeout: this.options.timeout,
      },
    );
  }
}

export default MCPConnection;
