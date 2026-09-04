import * as child_process from "child_process";
import * as fs from "fs";
import * as util from "util";

import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { findUp } from "find-up";

import { parseEnvNumber } from "../util/truncateOutput.js";
import {
  getWorkspaceDirectory,
  resolvePathInWorkspace,
} from "../util/workspace.js";

import { Tool, ToolRunContext } from "./types.js";

const execFilePromise = util.promisify(child_process.execFile);

async function getGitignorePatterns(
  searchPath: string = getWorkspaceDirectory(),
) {
  const gitIgnorePath = await findUp(".gitignore", { cwd: searchPath });
  if (!gitIgnorePath) return [];
  const content = fs.readFileSync(gitIgnorePath, "utf-8");
  const ignorePatterns = [];
  for (let line of content.trim().split("\n")) {
    line = line.trim();
    if (line.startsWith("#") || line === "") continue; // ignore comments and empty line
    if (line.startsWith("!")) continue; // ignore negated ignores
    ignorePatterns.push(line);
  }
  return ignorePatterns;
}

// procedure 1: search with ripgrep
export async function checkIfRipgrepIsInstalled(): Promise<boolean> {
  try {
    await execFilePromise("rg", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function searchWithRipgrep(
  pattern: string,
  searchPath: string,
  filePattern?: string,
  signal?: AbortSignal,
) {
  const args = ["--line-number", "--with-filename", "--color", "never"];

  if (filePattern) {
    args.push("-g", filePattern);
  }

  const ignorePatterns = await getGitignorePatterns(searchPath);
  for (const ignorePattern of ignorePatterns) {
    args.push("-g", `!${ignorePattern}`);
  }

  // End option parsing before user-controlled pattern and path arguments.
  args.push("--", pattern, searchPath);
  const { stdout, stderr } = await execFilePromise("rg", args, {
    maxBuffer: 10 * 1024 * 1024,
    signal,
  });
  return { stdout, stderr };
}

// procedure 2: search with grep on unix or findstr on windows
async function searchWithGrepOrFindstr(
  pattern: string,
  searchPath: string,
  filePattern?: string,
  signal?: AbortSignal,
) {
  const isWindows = process.platform === "win32";
  const ignorePatterns = await getGitignorePatterns(searchPath);
  if (isWindows) {
    const fileSpec = filePattern ? filePattern : "*";
    const args = ["/S", "/N", "/P", "/R", pattern, fileSpec];
    return await execFilePromise("findstr", args, {
      cwd: searchPath,
      maxBuffer: 10 * 1024 * 1024,
      signal,
    });
  } else {
    const args = ["-R", "-n", "-H", "-I"];
    if (filePattern) {
      args.push("--include", filePattern);
    }
    for (const ignorePattern of ignorePatterns) {
      // Use separate argv entries so patterns cannot become shell syntax.
      args.push("--exclude", ignorePattern, "--exclude-dir", ignorePattern);
    }
    args.push("--", pattern, ".");
    return await execFilePromise("grep", args, {
      cwd: searchPath,
      maxBuffer: 10 * 1024 * 1024,
      signal,
    });
  }
}

// Output truncation defaults
const DEFAULT_SEARCH_MAX_RESULTS = 100;
const DEFAULT_SEARCH_MAX_RESULT_CHARS = 1000; // Max chars per result line

function getSearchMaxResults(): number {
  return parseEnvNumber(
    process.env.CONTINUE_CLI_SEARCH_CODE_MAX_RESULTS,
    DEFAULT_SEARCH_MAX_RESULTS,
  );
}

function getSearchMaxResultChars(): number {
  return parseEnvNumber(
    process.env.CONTINUE_CLI_SEARCH_CODE_MAX_RESULT_CHARS,
    DEFAULT_SEARCH_MAX_RESULT_CHARS,
  );
}

export const searchCodeTool: Tool = {
  name: "Search",
  displayName: "Search",
  description: "Search the codebase using ripgrep (rg) for a specific pattern",
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "The search pattern to look for",
      },
      path: {
        type: "string",
        description: "The path to search in (defaults to current directory)",
      },
      file_pattern: {
        type: "string",
        description: "Optional file pattern to filter results (e.g., '*.ts')",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  preprocess: async (args) => {
    const truncatedPattern =
      args.pattern.length > 50
        ? args.pattern.substring(0, 50) + "..."
        : args.pattern;
    return {
      args,
      preview: [
        {
          type: "text",
          content: `Will search for: "${truncatedPattern}"`,
        },
      ],
    };
  },
  run: async (
    args: {
      pattern: string;
      path?: string;
      file_pattern?: string;
    },
    context?: ToolRunContext,
  ): Promise<string> => {
    const searchPath = resolvePathInWorkspace(
      args.path || getWorkspaceDirectory(),
    );
    if (!fs.existsSync(searchPath)) {
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        `Path does not exist: ${searchPath}`,
      );
    }

    let stdout = "",
      stderr = "";
    try {
      if (await checkIfRipgrepIsInstalled()) {
        const results = await searchWithRipgrep(
          args.pattern,
          searchPath,
          args.file_pattern,
          context?.signal,
        );
        stdout = results.stdout;
        stderr = results.stderr;
      } else {
        const results = await searchWithGrepOrFindstr(
          args.pattern,
          searchPath,
          args.file_pattern,
          context?.signal,
        );
        stdout = results.stdout;
        stderr = results.stderr;
      }

      if (stderr) {
        return `Warning during search: ${stderr}\n\n${stdout}`;
      }

      if (!stdout.trim()) {
        return `No matches found for pattern "${args.pattern}"${
          args.file_pattern ? ` in files matching "${args.file_pattern}"` : ""
        }.`;
      }

      // Split the results into lines and limit the number of results
      const maxResults = getSearchMaxResults();
      const maxResultChars = getSearchMaxResultChars();

      const splitLines = stdout.split("\n");
      const lines = splitLines.filter((line) => line.length <= maxResultChars);
      if (lines.length === 0) {
        return `No matches found for pattern "${args.pattern}"${
          args.file_pattern ? ` in files matching "${args.file_pattern}"` : ""
        }.`;
      }
      const truncated = lines.length > maxResults;
      const limitedLines = lines.slice(0, maxResults);
      const resultText = limitedLines.join("\n");

      const truncationMessage = truncated
        ? `\n\n[Results truncated: showing ${maxResults} of ${lines.length} matches]`
        : "";

      return `Search results for pattern "${args.pattern}"${
        args.file_pattern ? ` in files matching "${args.file_pattern}"` : ""
      }:\n\n${resultText}${truncationMessage}`;
    } catch (error: any) {
      if (error instanceof ContinueError) {
        throw error;
      }
      if (error.code === 1) {
        return `No matches found for pattern "${args.pattern}"${
          args.file_pattern ? ` in files matching "${args.file_pattern}"` : ""
        }.`;
      }
      throw new Error(
        `Error executing search: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};
