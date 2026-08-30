import fs from "node:fs/promises";
import path from "node:path";

import type {
  ContentBlock,
  ToolCallStatus,
  ToolKind,
} from "@agentclientprotocol/sdk";
import type { ChatHistoryItem, Session, ToolStatus } from "core/index.js";

export function toolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  if (
    name === "bash" ||
    name.includes("terminal") ||
    name.includes("command")
  ) {
    return "execute";
  }
  if (name.includes("search") || name === "grep" || name === "find") {
    return "search";
  }
  if (
    name.includes("read") ||
    name === "list" ||
    name === "diff" ||
    name.includes("view")
  ) {
    return "read";
  }
  if (name.includes("delete") || name.includes("remove")) {
    return "delete";
  }
  if (name.includes("move")) {
    return "move";
  }
  if (
    name.includes("edit") ||
    name.includes("write") ||
    name.includes("create")
  ) {
    return "edit";
  }
  return "other";
}

export function toolStatus(status: ToolStatus): ToolCallStatus {
  switch (status) {
    case "calling":
      return "in_progress";
    case "done":
      return "completed";
    case "errored":
    case "canceled":
      return "failed";
    default:
      return "in_progress";
  }
}

export function textContent(content: string): ContentBlock {
  return { type: "text", text: content };
}

export function toPromptText(prompt: ContentBlock[]): string {
  const text: string[] = [];
  for (const block of prompt) {
    if (block.type !== "text") {
      throw new Error(
        `Unsupported ACP content block type '${block.type}'. Continue currently supports text prompts only.`,
      );
    }
    text.push(block.text);
  }
  return text.join("");
}

export async function validateDirectory(
  input: string,
  label: string,
): Promise<string> {
  if (!path.isAbsolute(input)) {
    throw new Error(`${label} must be an absolute path`);
  }

  const resolved = path.resolve(input);
  const realPath = await fs.realpath(resolved).catch(() => {
    throw new Error(`${label} does not exist or is not accessible`);
  });
  const stats = await fs.stat(realPath);
  if (!stats.isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  return realPath;
}

export function sessionFromHistory(
  sessionId: string,
  cwd: string,
  history: ChatHistoryItem[],
): Session {
  return {
    sessionId,
    title: "ACP Session",
    workspaceDirectory: cwd,
    history,
    usage: {
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      promptTokensDetails: {
        cachedTokens: 0,
        cacheWriteTokens: 0,
      },
    },
  };
}

export function absoluteLocations(cwd: string, args: unknown) {
  if (!args || typeof args !== "object") {
    return [];
  }

  const locations: Array<{ path: string }> = [];
  for (const [key, value] of Object.entries(args)) {
    if (
      typeof value === "string" &&
      (key === "path" ||
        key === "file_path" ||
        key === "filepath" ||
        key === "dirpath")
    ) {
      locations.push({
        path: path.isAbsolute(value)
          ? path.normalize(value)
          : path.resolve(cwd, value),
      });
    }
  }
  return locations;
}
