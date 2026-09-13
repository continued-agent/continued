import * as os from "node:os";
import * as path from "path";

import { AssistantUnrolled } from "@continuedev/config-yaml";

import type { ConfigSource } from "./configLoader.js";
import { env } from "./env.js";

/**
 * Preserve the trust boundary of the configuration source on MCP entries.
 * Stdio MCP servers execute a local command, so the MCP service must be able
 * to distinguish the user's global config from a repository, remote assistant,
 * or shared package before it starts one.
 */
export function markMcpServerProvenance(
  config: AssistantUnrolled,
  source: ConfigSource,
): void {
  if (!config.mcpServers?.length) {
    return;
  }

  let sourceFile: string | undefined;
  let sourceSlug: string | undefined;
  if (source.type === "local-config-yaml") {
    // The default config under ~/.continue is user-controlled and trusted.
    // A local config supplied through another path is handled by `cli-flag`.
    return;
  } else if (source.type === "cli-flag") {
    if (isFilePath(source.path)) {
      const configPath = path.resolve(
        source.path.replace(/^~(?=$|[/\\])/, os.homedir()),
      );
      const trustedRoot = path.resolve(env.continueHome);
      const relative = path.relative(trustedRoot, configPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        sourceFile = configPath;
      }
    } else {
      sourceSlug = `assistant:${source.path}`;
    }
  } else if (source.type === "saved-uri") {
    sourceSlug = `saved:${source.uri}`;
  } else {
    sourceSlug = `source:${source.type}`;
  }

  if (!sourceFile && !sourceSlug) {
    return;
  }
  for (const server of config.mcpServers) {
    if (server && typeof server === "object") {
      if (sourceFile && !server.sourceFile) {
        server.sourceFile = sourceFile;
      }
      if (sourceSlug && !server.sourceSlug) {
        server.sourceSlug = sourceSlug;
      }
    }
  }
}

function isFilePath(configPath: string): boolean {
  return (
    configPath.startsWith(".") ||
    configPath.startsWith("/") ||
    configPath.startsWith("~") ||
    /^[A-Za-z]:[/\\]/.test(configPath) ||
    configPath.startsWith("\\\\") ||
    configPath.includes(".yaml") ||
    configPath.includes(".yml") ||
    configPath.includes(".json")
  );
}
