import * as fs from "fs";
import * as path from "path";

import { throwIfFileIsSecurityConcern } from "core/indexing/ignore.js";
import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { createTwoFilesPatch } from "diff";

import { telemetryService } from "../telemetry/telemetryService.js";
import {
  calculateLinesOfCodeDiff,
  getLanguageFromFilePath,
} from "../telemetry/utils.js";
import { resolvePathInWorkspace } from "../util/workspace.js";

import { Tool, ToolCallPreview } from "./types.js";

function resolveSafeWritePath(filepath: string): string {
  let existingPath = filepath;
  const missingPathSegments: string[] = [];

  while (!fs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) {
      throw new Error(`Could not find an existing parent for ${filepath}`);
    }
    missingPathSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }

  // Resolve the closest existing ancestor before writing. This catches a
  // workspace directory symlink that would otherwise redirect a new file into
  // a sensitive location, and gives us a stable canonical path for the write.
  const realExistingPath = fs.realpathSync(existingPath);
  throwIfFileIsSecurityConcern(realExistingPath);
  const safeWritePath = path.join(realExistingPath, ...missingPathSegments);
  throwIfFileIsSecurityConcern(safeWritePath);

  return safeWritePath;
}

export function generateDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  return createTwoFilesPatch(
    filePath,
    filePath,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: 3 },
  );
}

export const writeFileTool: Tool = {
  name: "Write",
  displayName: "Write",
  description: "Write content to a file at the specified path",
  parameters: {
    type: "object",
    required: ["filepath", "content"],
    properties: {
      filepath: {
        type: "string",
        description: "The path to the file to write",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
  },
  readonly: false,
  isBuiltIn: true,
  preprocess: async (args) => {
    const inputPath = args?.filepath;
    if (typeof inputPath !== "string") {
      throw new Error("Filepath must be a string");
    }
    const filepath = resolvePathInWorkspace(inputPath);
    throwIfFileIsSecurityConcern(filepath);
    let safeWritePath: string;
    try {
      safeWritePath = resolveSafeWritePath(filepath);
    } catch {
      // If we cannot resolve a safe write path (e.g. the file system is
      // unavailable or the path walks outside the workspace), fall back to
      // the plain resolved path; the write itself still validates.
      safeWritePath = filepath;
    }
    const content = args?.content ?? "";
    if (typeof content !== "string") {
      throw new Error("New file content must be a string");
    }
    try {
      if (fs.existsSync(safeWritePath)) {
        const oldContent = fs.readFileSync(safeWritePath, "utf-8");

        const diff = createTwoFilesPatch(
          args.filepath,
          args.filepath,
          oldContent,
          content,
          undefined,
          undefined,
          { context: 2 },
        );

        return {
          args,
          preview: [
            {
              type: "text",
              content: "Preview of changes:",
            },
            {
              type: "diff",
              content: diff,
            },
          ],
        };
      }
    } catch {
      // do nothing
    }
    const lines: string[] = content.split("\n");
    const previewLines = lines.slice(0, 3);

    const preview: ToolCallPreview[] = [
      {
        type: "text",
        content: "New file content:",
      },
      ...previewLines.map((line) => ({
        type: "text" as const,
        content: line || " ",
        paddingLeft: 2,
      })),
    ];
    if (lines.length > 3) {
      preview.push({
        type: "text",
        content: `... (${lines.length - 3} more lines)`,
      });
    }

    return {
      args: {
        filepath,
        content,
      },
      preview,
    };
  },
  run: async (args: { filepath: string; content: string }): Promise<string> => {
    try {
      const resolvedFilepath = resolvePathInWorkspace(args.filepath);
      throwIfFileIsSecurityConcern(resolvedFilepath);
      const filepath = resolveSafeWritePath(resolvedFilepath);
      const dirPath = path.dirname(filepath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Read existing file content if it exists
      let oldContent = "";
      if (fs.existsSync(filepath)) {
        oldContent = fs.readFileSync(filepath, "utf-8");
      }

      // Do not follow a symlink that may have replaced the path after workspace
      // resolution. Windows does not support O_NOFOLLOW, but still benefits from
      // the canonical-path checks above.
      const noFollow =
        process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW;
      const fileDescriptor = fs.openSync(
        filepath,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_TRUNC |
          noFollow,
        0o600,
      );
      try {
        fs.writeFileSync(fileDescriptor, args.content, "utf-8");
      } finally {
        fs.closeSync(fileDescriptor);
      }

      // Track lines of code changes if file existed before
      if (oldContent) {
        const { added, removed } = calculateLinesOfCodeDiff(
          oldContent,
          args.content,
        );
        const language = getLanguageFromFilePath(filepath);

        if (added > 0) {
          telemetryService.recordLinesOfCodeModified("added", added, language);
        }
        if (removed > 0) {
          telemetryService.recordLinesOfCodeModified(
            "removed",
            removed,
            language,
          );
        }

        // Generate diff for result display
        const diff = generateDiff(oldContent, args.content, filepath);

        return `Successfully wrote to file: ${filepath}\nDiff:\n${diff}`;
      } else {
        // New file creation - count all lines as added
        const lineCount = args.content.split("\n").length;
        const language = getLanguageFromFilePath(filepath);

        telemetryService.recordLinesOfCodeModified(
          "added",
          lineCount,
          language,
        );

        return `Successfully created file: ${filepath}`;
      }
    } catch (error) {
      if (error instanceof ContinueError) {
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code === "ELOOP") {
        throw new ContinueError(
          ContinueErrorReason.FileIsSecurityConcern,
          `Refusing to follow symlink while writing ${args.filepath}`,
        );
      }
      throw new ContinueError(
        ContinueErrorReason.FileWriteError,
        `Error writing to file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};
