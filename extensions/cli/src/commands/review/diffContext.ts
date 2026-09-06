import { execFileSync } from "node:child_process";

import { logger } from "../../util/logger.js";

const MAX_DIFF_SIZE = 50 * 1024; // 50KB

export interface DiffContext {
  baseBranch: string;
  diff: string;
  changedFiles: string[];
  stat: string;
  truncated: boolean;
}

const GIT_COMMAND_OPTIONS = {
  encoding: "utf-8" as const,
  stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
};

/**
 * Auto-detect the default branch (main/master) for the current repo.
 */
function detectDefaultBranch(): string {
  try {
    const ref = execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      GIT_COMMAND_OPTIONS,
    ).trim();
    // refs/remotes/origin/main -> main
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    // Fallback: check if main or master exists
    try {
      execFileSync(
        "git",
        ["rev-parse", "--verify", "--end-of-options", "main"],
        GIT_COMMAND_OPTIONS,
      );
      return "main";
    } catch {
      try {
        execFileSync(
          "git",
          ["rev-parse", "--verify", "--end-of-options", "master"],
          GIT_COMMAND_OPTIONS,
        );
        return "master";
      } catch {
        return "main"; // Default fallback
      }
    }
  }
}

/**
 * Compute the diff context for the current working tree against a base branch.
 * Includes both committed changes on the branch AND uncommitted changes.
 */
export function computeDiffContext(baseBranch?: string): DiffContext {
  const base = baseBranch || detectDefaultBranch();

  // Get the merge-base to handle diverged branches. Revisions are passed as
  // arguments (never interpolated into a shell command) and --end-of-options
  // prevents a ref beginning with '-' from being parsed as a Git option.
  let mergeBase: string;
  try {
    mergeBase = execFileSync(
      "git",
      ["merge-base", "--end-of-options", base, "HEAD"],
      GIT_COMMAND_OPTIONS,
    ).trim();
  } catch {
    logger.warn(
      `Could not find merge-base with ${base}, falling back to direct diff`,
    );
    mergeBase = base;
  }

  // Get diff of committed changes + working tree changes against the base
  let diff: string;
  let truncated = false;
  try {
    // Use diff against merge-base to include all branch changes + working tree
    diff = execFileSync("git", ["diff", "--end-of-options", mergeBase], {
      ...GIT_COMMAND_OPTIONS,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
  } catch {
    diff = "";
  }

  if (diff.length > MAX_DIFF_SIZE) {
    diff = diff.slice(0, MAX_DIFF_SIZE);
    truncated = true;
  }

  // Get changed file list
  let changedFiles: string[] = [];
  try {
    const fileList = execFileSync(
      "git",
      ["diff", "--name-only", "--end-of-options", mergeBase],
      GIT_COMMAND_OPTIONS,
    ).trim();
    changedFiles = fileList ? fileList.split("\n") : [];
  } catch {
    changedFiles = [];
  }

  // Get diff stat
  let stat = "";
  try {
    stat = execFileSync(
      "git",
      ["diff", "--stat", "--end-of-options", mergeBase],
      GIT_COMMAND_OPTIONS,
    ).trim();
  } catch {
    stat = "";
  }

  return {
    baseBranch: base,
    diff,
    changedFiles,
    stat,
    truncated,
  };
}
