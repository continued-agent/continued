import { configureConsoleForHeadless, safeStderr } from "../init.js";
import { logger } from "../util/logger.js";

import { createRemoteOptions, validateNoTuiInvocation } from "./options.js";
import { startRemoteServer } from "./server.js";

export interface RootCommandOptions {
  tui?: boolean;
  print?: boolean;
  format?: "json";
  silent?: boolean;
  verbose?: boolean;
  headless?: boolean;
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
  readonly?: boolean;
  auto?: boolean;
  config?: string;
  org?: string;
  rule?: string[];
  allow?: string[];
  ask?: string[];
  exclude?: string[];
  model?: string[];
  mcp?: string[];
  betaStatusTool?: boolean;
  betaSubagentTool?: boolean;
  betaUploadArtifactTool?: boolean;
}

export async function runRemoteMode(
  prompt: string | undefined,
  options: RootCommandOptions,
): Promise<void> {
  const validationErrors = validateNoTuiInvocation({
    prompt,
    options: {
      noTui: true,
      print: options.print,
      resume: options.resume,
      fork: options.fork,
      session: options.session,
      prompt: options.prompt,
      agent: options.agent,
    },
  });
  if (validationErrors.length > 0) {
    safeStderr(`${validationErrors.join("\n")}\n`);
    process.exitCode = 2;
    return;
  }

  configureConsoleForHeadless(true);
  logger.configureHeadlessMode(true);
  let remoteOptions;
  try {
    remoteOptions = await createRemoteOptions({
      host: options.host,
      port: options.port,
      authToken: options.authToken,
      workspace: options.workspace,
      session: options.session,
      logLevel: options.logLevel,
      corsOrigin: options.corsOrigin,
      readOnly: options.readOnly,
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
    });
  } catch (error) {
    safeStderr(
      `Invalid remote server options: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 2;
    return;
  }
  logger.setLevel(remoteOptions.logLevel);
  try {
    await startRemoteServer(remoteOptions);
  } catch (error) {
    safeStderr(
      `Remote server failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
