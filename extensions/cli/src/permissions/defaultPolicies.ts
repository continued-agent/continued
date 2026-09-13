import { ToolPermissionPolicy } from "./types.js";

/**
 * Default permission policies for all built-in tools.
 * These policies are applied in order - first match wins.
 *
 * Bash and unknown tools (MCP, external) default to `ask` regardless of mode.
 * In headless mode there is no interactive approver, so `ask` tools are
 * excluded from the agent's toolset: an unattended run must explicitly opt in
 * with `--allow Bash`, `--allow "*"`, or `--auto`. This matches the documented
 * headless behavior and prevents prompt injection from silently executing
 * arbitrary commands.
 */
export function getDefaultToolPolicies(): ToolPermissionPolicy[] {
  return [
    // Write tools
    { tool: "Edit", permission: "ask" },
    { tool: "MultiEdit", permission: "ask" },
    { tool: "Write", permission: "ask" },
    { tool: "CheckBackgroundJob", permission: "allow" },
    { tool: "AskQuestion", permission: "allow" },
    { tool: "Checklist", permission: "allow" },
    { tool: "Diff", permission: "allow" },
    { tool: "Skills", permission: "allow" },
    { tool: "Exit", permission: "allow" }, // Exit tool is generally safe (headless mode only)
    { tool: "Fetch", permission: "allow" }, // Technically not read only but edge casey to post w query params
    { tool: "List", permission: "allow" },
    { tool: "Read", permission: "allow" },
    { tool: "Search", permission: "allow" },
    { tool: "Status", permission: "allow" },
    { tool: "ReportFailure", permission: "allow" },
    { tool: "UploadArtifact", permission: "allow" },
    // Bash and unknown (MCP/external) tools require an explicit grant. In
    // headless mode `ask` tools are excluded, so unattended runs must opt in.
    { tool: "Bash", permission: "ask" },
    { tool: "*", permission: "ask" },
  ];
}

// Plan mode: Complete override - exclude all write operations and anything
// that could mutate state. Bash is ask so mutating commands are gated on
// explicit user consent, and unknown tools (including MCP tools) are excluded
// unless explicitly allowed above.
export const PLAN_MODE_POLICIES: ToolPermissionPolicy[] = [
  { tool: "Edit", permission: "exclude" },
  { tool: "MultiEdit", permission: "exclude" },
  { tool: "Write", permission: "exclude" },

  // Bash can mutate the filesystem and run arbitrary commands, so it must be
  // gated on explicit user approval even in Plan mode.
  { tool: "Bash", permission: "ask" },
  { tool: "CheckBackgroundJob", permission: "allow" },
  { tool: "AskQuestion", permission: "allow" },
  { tool: "Checklist", permission: "allow" },
  { tool: "Diff", permission: "allow" },
  { tool: "Exit", permission: "allow" },
  { tool: "Fetch", permission: "allow" },
  { tool: "List", permission: "allow" },
  { tool: "Read", permission: "allow" },
  { tool: "ReportFailure", permission: "allow" },
  { tool: "Search", permission: "allow" },
  { tool: "Skills", permission: "allow" },
  { tool: "Status", permission: "allow" },
  { tool: "UploadArtifact", permission: "allow" },

  // Do not allow unknown tools (e.g. MCP tools) in Plan mode: they can
  // perform arbitrary external mutations.
  { tool: "*", permission: "exclude" },
];

// Auto mode: Complete override - allow everything without asking
export const AUTO_MODE_POLICIES: ToolPermissionPolicy[] = [
  { tool: "*", permission: "allow" },
];

// Review mode: allow only read-only built-in tools. In particular, do not allow
// Bash, network access, MCP tools, or writes from untrusted review instructions.
export const REVIEW_MODE_POLICIES: ToolPermissionPolicy[] = [
  { tool: "Read", permission: "allow" },
  { tool: "List", permission: "allow" },
  { tool: "Search", permission: "allow" },
  { tool: "Diff", permission: "allow" },
  { tool: "*", permission: "exclude" },
];
