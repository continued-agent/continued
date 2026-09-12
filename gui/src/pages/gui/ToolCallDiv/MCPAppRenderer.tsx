import {
  McpUiResourceCsp,
  McpUiResourcePermissions,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps";

import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ToolPolicy } from "@continuedev/terminal-security";
import type { Tool, ToolCallState } from "core";
import { getToolNameFromMCPServer } from "core/tools/mcpToolName";
import { isBlockedUrl } from "core/util/urlSecurity";
import { generateOpenAIToolCallId } from "core/tools/systemMessageTools/systemToolUtils";
import { renderContextItems } from "core/util/messageContent";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { streamResponseThunk } from "../../../redux/thunks/streamResponse";

/**
 * Build a CSP meta tag content string from McpUiResourceCsp configuration.
 * This allows the iframe to make network requests to the specified domains.
 */
export function buildCspMetaContent(csp: McpUiResourceCsp | undefined): string {
  const resourceDomains = csp?.resourceDomains ?? [];
  const connectDomains = csp?.connectDomains ?? [];

  // Only accept origin-shaped HTTP(S) sources. Treating arbitrary metadata as
  // CSP text would let a malicious MCP server break out of the policy tag.
  const isValidOrigin = (domain: string) => {
    try {
      const parsed = new URL(domain);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        !parsed.username &&
        !parsed.password &&
        parsed.pathname === "/" &&
        !parsed.search &&
        !parsed.hash &&
        !isBlockedUrl(parsed) &&
        ["80", "443", ""].includes(parsed.port)
      );
    } catch {
      return false;
    }
  };
  const validResourceDomains = resourceDomains.filter(isValidOrigin);
  const validConnectDomains = connectDomains.filter(isValidOrigin);

  const defaultSrc = ["'self'", "blob:", "data:", ...validResourceDomains].join(
    " ",
  );
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "blob:",
    ...validResourceDomains,
  ].join(" ");
  const styleSrc = ["'self'", "'unsafe-inline'", ...validResourceDomains].join(
    " ",
  );
  const imgSrc = ["'self'", "blob:", "data:", ...validResourceDomains].join(
    " ",
  );
  const fontSrc = ["'self'", "data:", ...validResourceDomains].join(" ");
  const connectSrc = ["'self'", "blob:", "data:", ...validConnectDomains].join(
    " ",
  );
  const mediaSrc = ["'self'", "blob:", "data:", ...validResourceDomains].join(
    " ",
  );
  const frameSrc = "'none'";
  const workerSrc = ["'self'", "blob:", ...validResourceDomains].join(" ");

  const directives = [
    `default-src ${defaultSrc}`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src ${imgSrc}`,
    `font-src ${fontSrc}`,
    `connect-src ${connectSrc}`,
    `media-src ${mediaSrc}`,
    `frame-src ${frameSrc}`,
    `worker-src ${workerSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ];

  return directives.join("; ");
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * MCP UI content must be authorized against the tool it actually requests,
 * rather than the tool that happened to render the UI resource.
 */
export function resolveMcpAppToolPolicy(
  toolName: string,
  configuredPolicies: Record<string, ToolPolicy>,
  availableTools: Tool[],
): ToolPolicy {
  return (
    configuredPolicies[toolName] ??
    availableTools.find((tool) => tool.function.name === toolName)
      ?.defaultToolPolicy ??
    "allowedWithPermission"
  );
}

/**
 * MCP App renderer using AppBridge with srcdoc iframe.
 * VS Code webviews have restrictive CSP that blocks iframe src URLs,
 * so we embed HTML directly via srcdoc and use AppBridge for the protocol.
 *
 * Handles MCP UI resource metadata:
 * - `permissions`: Reports unsupported requested permissions without delegating
 *   them to the sandboxed iframe
 * - `csp`: Passes CSP config to the app via sendSandboxResourceReady
 * - `prefersBorder`: Controls iframe border styling
 *
 * Sensitive permissions are intentionally not delegated to untrusted MCP HTML.
 */
export function McpAppRenderer({
  toolCallState,
}: {
  toolCallState: ToolCallState;
}) {
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const appBridgeRef = useRef<AppBridge | null>(null);
  const [iframeHeight, setIframeHeight] = useState(300);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const html = toolCallState.mcpUiState?.content.text;
  const uiMeta = toolCallState.mcpUiState?.content._meta?.ui;
  const toolInput = toolCallState.parsedArgs;
  const toolResult = toolCallState.output;
  const configuredToolPolicies = useAppSelector(
    (state) => state.ui.toolSettings,
  );
  const availableTools = useAppSelector((state) => state.config.config.tools);
  const toolCallStateRef = useRef(toolCallState);
  toolCallStateRef.current = toolCallState;
  const configuredToolPoliciesRef = useRef(configuredToolPolicies);
  configuredToolPoliciesRef.current = configuredToolPolicies;
  const availableToolsRef = useRef(availableTools);
  availableToolsRef.current = availableTools;

  // Extract metadata from the MCP UI resource
  const csp: McpUiResourceCsp | undefined = uiMeta?.csp;
  const permissions: McpUiResourcePermissions | undefined = uiMeta?.permissions;
  const prefersBorder = uiMeta?.prefersBorder ?? true;

  const [permissionWarningDismissed, setPermissionWarningDismissed] =
    useState(false);

  const restrictedPermissions = useMemo(() => {
    const restricted: string[] = [];
    if (permissions?.microphone) restricted.push("microphone");
    if (permissions?.camera) restricted.push("camera");
    if (permissions?.geolocation) restricted.push("geolocation");
    if (permissions?.clipboardWrite) restricted.push("clipboard-write");
    return restricted;
  }, [permissions]);

  const hasRestrictedPermissions = restrictedPermissions.length > 0;

  const sandboxAttribute = useMemo(() => {
    // SECURITY: Do NOT add 'allow-same-origin' together with 'allow-scripts'.
    // This combination allows untrusted MCP HTML to access the parent webview
    // via window.parent, defeating iframe sandboxing. Communication via
    // PostMessageTransport works without same-origin access.
    const sandboxPermissions = [
      "allow-scripts", // Required for MCP app JavaScript execution
    ];
    return sandboxPermissions.join(" ");
  }, []);

  // Never delegate camera, microphone, geolocation, or clipboard privileges
  // from an MCP server to sandboxed third-party HTML.
  const allowAttribute = undefined;

  useEffect(() => {
    const bridge = new AppBridge(
      null,
      { name: "Continue", version: "1.0.0" },
      {
        openLinks: {},
        logging: {},
        message: { text: {} },
        updateModelContext: { text: {}, structuredContent: {} },
        serverTools: {},
      },
    );

    bridge.onsizechange = (params: { width?: number; height?: number }) => {
      if (params.height !== undefined) {
        setIframeHeight(Math.min(Math.max(params.height + 20, 100), 800));
      }
    };

    bridge.oninitialized = () => {
      setIsInitialized(true);
    };

    bridge.onopenlink = async (params: { url: string }) => {
      try {
        const url = new URL(params.url);
        if (
          (url.protocol === "http:" || url.protocol === "https:") &&
          !url.username &&
          !url.password
        ) {
          ideMessenger.post("openUrl", url.toString());
        }
      } catch {
        console.warn("[McpAppRenderer] Refused to open an invalid URL");
      }
      return {};
    };

    bridge.onmessage = async (params: { role: string; content: unknown[] }) => {
      const text = params.content
        .filter((item: any) => item.type === "text" && item.text)
        .map((item: any) => item.text)
        .join("\n");

      if (!text) {
        console.warn(
          "[McpAppRenderer] onMessage received with no text content",
        );
        return {};
      }

      // MCP UI content is untrusted. Require an explicit user gesture before
      // it can inject a new prompt into the main conversation.
      if (
        typeof window.confirm !== "function" ||
        !window.confirm(
          `This MCP app wants to send a message to Continue:\n\n${text}`,
        )
      ) {
        return {};
      }

      const editorState = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text }],
          },
        ],
      };

      void dispatch(
        streamResponseThunk({
          editorState,
          modifiers: { noContext: true, useCodebase: false },
        }),
      );

      return {};
    };

    bridge.oncalltool = async (params: any) => {
      const currentToolCallState = toolCallStateRef.current;
      const serverName = currentToolCallState.tool?.group;
      if (!serverName?.trim()) {
        throw new Error(
          "MCP App tool call denied: missing MCP server identity",
        );
      }
      const toolName = getToolNameFromMCPServer(serverName, params.name);
      const parsedArgs =
        params.arguments &&
        typeof params.arguments === "object" &&
        !Array.isArray(params.arguments)
          ? params.arguments
          : {};
      const basePolicy = resolveMcpAppToolPolicy(
        toolName,
        configuredToolPoliciesRef.current,
        availableToolsRef.current,
      );
      const policyResult = await ideMessenger.request("tools/evaluatePolicy", {
        toolName,
        basePolicy,
        parsedArgs,
      });
      if (
        policyResult.status === "error" ||
        policyResult.content.policy !== "allowedWithoutPermission"
      ) {
        throw new Error(`MCP App tool call denied by policy: ${toolName}`);
      }

      const output = await ideMessenger.request("tools/call", {
        toolCall: {
          function: {
            name: toolName,
            arguments: JSON.stringify(parsedArgs),
          },
          id: generateOpenAIToolCallId(),
          type: "function",
        },
      });
      if (output.status === "error") {
        throw new Error(`Failed to call tool from MCP UI: ${output.error}`);
      }
      return {
        content: output.content.contextItems.map((ci) => ({
          type: "text",
          text: renderContextItems([ci]),
        })),
        isError: false,
      };
    };

    bridge.onlistresources = async () => {
      return { resources: [] };
    };

    bridge.onreadresource = async () => {
      throw new Error("Resource reads not supported in this context");
    };

    bridge.onloggingmessage = (params: {
      level: string;
      logger?: string;
      data: unknown;
    }) => {
      const logFn =
        params.level === "error" || params.level === "critical"
          ? console.error
          : params.level === "warning"
            ? console.warn
            : console.log;
      logFn(
        `[MCP App${params.logger ? ` - ${params.logger}` : ""}]`,
        params.data,
      );

      // If the MCP app reports an error, hide the UI rather than
      // showing broken/confusing content
      if (params.level === "error" || params.level === "critical") {
        setError(new Error(String(params.data)));
      }
    };

    bridge.onupdatemodelcontext = async () => {
      return {};
    };

    appBridgeRef.current = bridge;

    return () => {
      appBridgeRef.current = null;
    };
  }, [ideMessenger, dispatch]);

  // Connect bridge to iframe when it loads
  const handleIframeLoad = useCallback(async () => {
    const iframe = iframeRef.current;
    const bridge = appBridgeRef.current;
    if (!iframe?.contentWindow || !bridge) return;

    try {
      const transport = new PostMessageTransport(
        iframe.contentWindow,
        iframe.contentWindow,
      );

      await bridge.connect(transport);

      if (html) {
        await bridge.sendSandboxResourceReady({
          html,
          csp,
          permissions,
        });
      }
    } catch (err) {
      console.error("[Continue] Failed to connect bridge to MCP App UI:", err);
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [html, csp, permissions]);

  useEffect(() => {
    const bridge = appBridgeRef.current;
    if (!bridge || !isInitialized || !toolInput) return;
    try {
      bridge.sendToolInput({ arguments: toolInput });
    } catch (err) {
      console.warn("[McpAppRenderer] Failed to send tool input:", err);
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [isInitialized, toolInput]);

  useEffect(() => {
    const bridge = appBridgeRef.current;
    if (!bridge || !isInitialized || !toolResult) return;
    try {
      bridge.sendToolResult({
        content: toolResult.map((o) => ({
          type: "text" as const,
          text: o.content,
        })),
      });
    } catch (err) {
      console.warn("[McpAppRenderer] Failed to send tool result:", err);
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [isInitialized, toolResult]);

  if (!toolCallState.mcpUiState || !html) {
    return null;
  }

  if (error) {
    return null;
  }

  const cspMetaContent = escapeHtmlAttribute(buildCspMetaContent(csp));

  const srcdoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${cspMetaContent}">
  <style>
    html, body {
      margin: 0;
      padding: 0;
    }
    /* Minimal scrollbar styling */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(128, 128, 128, 0.4);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(128, 128, 128, 0.6);
    }
    ::-webkit-scrollbar-corner {
      background: transparent;
    }
    /* Firefox */
    html {
      scrollbar-width: thin;
      scrollbar-color: rgba(128, 128, 128, 0.4) transparent;
    }
  </style>
</head>
<body>
${html}
</body>
</html>`;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox={sandboxAttribute}
        allow={allowAttribute}
        onLoad={handleIframeLoad}
        className={`bg-input w-full ${
          prefersBorder ? "border-input rounded border" : "border-none"
        }`}
        style={{ height: iframeHeight }}
        title={`MCP App - ${toolCallState.toolCall.function.name}`}
      />

      {hasRestrictedPermissions && !permissionWarningDismissed && (
        <div
          className={`absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/85 p-5 ${
            prefersBorder ? "rounded" : ""
          }`}
        >
          <div className="max-w-[25rem] text-center">
            <div className="mb-3 text-2xl">⚠️</div>
            <p className="text-foreground mb-2 text-sm font-medium">
              Limited Functionality
            </p>
            <p className="text-description mb-4 text-xs leading-relaxed">
              This app requires{" "}
              <strong className="text-foreground">
                {restrictedPermissions.join(", ")}
              </strong>{" "}
              access, which is not currently supported. Some features may not
              work.
            </p>
            <button
              onClick={() => setPermissionWarningDismissed(true)}
              className="bg-primary text-primary-foreground hover:bg-primary-hover cursor-pointer rounded border-none px-4 py-2 text-xs font-medium"
            >
              Continue Anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
