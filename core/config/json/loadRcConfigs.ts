import * as JSONC from "comment-json";
import { ContinueRcJson, FileType, IDE } from "../..";
import { joinPathsToUri } from "../../util/uri";

export interface WorkspaceRcConfig {
  config: ContinueRcJson;
  /** URI of the `.continuerc.json` file this config was read from. */
  sourceFile: string;
}

export async function getWorkspaceRcConfigs(
  ide: IDE,
): Promise<WorkspaceRcConfig[]> {
  try {
    const workspaces = await ide.getWorkspaceDirs();
    const rcFiles = await Promise.all(
      workspaces.map(async (dir) => {
        const ls = await ide.listDir(dir);
        const rcFiles = ls
          .filter(
            (entry) =>
              (entry[1] === (1 as FileType.File) ||
                entry[1] === (64 as FileType.SymbolicLink)) &&
              entry[0].endsWith(".continuerc.json"),
          )
          .map((entry) => joinPathsToUri(dir, entry[0]));
        return await Promise.all(
          rcFiles.map(async (uri) => ({
            uri,
            content: await ide.readFile(uri),
          })),
        );
      }),
    );
    return rcFiles.flat().map(({ uri, content }) => ({
      config: markWorkspaceMcpServers(JSONC.parse(content), uri),
      sourceFile: uri,
    }));
  } catch (e) {
    console.debug("Failed to load workspace configs: ", e);
    return [];
  }
}

/**
 * Workspace `.continuerc.json` files can declare MCP servers. Because opening a
 * cloned repository must not silently spawn its stdio servers, tag every
 * declared MCP server with the source file so that `isWorkspaceMcpServer`
 * recognizes it and the approval gate applies. Without this provenance, a
 * workspace server would look like a user-provided one and start automatically.
 */
function markWorkspaceMcpServers(
  config: any,
  sourceFile: string,
): ContinueRcJson {
  const servers = config?.experimental?.modelContextProtocolServers;
  if (Array.isArray(servers)) {
    for (const server of servers) {
      if (server && typeof server === "object") {
        server.sourceFile = sourceFile;
      }
    }
  }
  return config as ContinueRcJson;
}
