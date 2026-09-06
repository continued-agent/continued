import { Box, Text } from "ink";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ToolPermissionServiceState } from "src/services/ToolPermissionService.js";

import { useServices } from "../hooks/useService.js";
import {
  ApiClientServiceState,
  AuthServiceState,
  ConfigServiceState,
  MCPServiceState,
  ModelServiceState,
  UpdateServiceState,
} from "../services/types.js";
import { getTotalSessionCost } from "../session.js";
import { bashToolEvents } from "../util/cli.js";

import { ActionStatus } from "./components/ActionStatus.js";
import { BottomStatusBar } from "./components/BottomStatusBar.js";
import { ResourceDebugBar } from "./components/ResourceDebugBar.js";
import { ScreenContent } from "./components/ScreenContent.js";
import { StaticChatContent } from "./components/StaticChatContent.js";
import { useNavigation } from "./context/NavigationContext.js";
import { useChat } from "./hooks/useChat.js";
import { useContextPercentage } from "./hooks/useContextPercentage.js";
import { useMessageRenderer } from "./hooks/useMessageRenderer.js";
import { useIntroMessage, useSelectors } from "./hooks/useTUIChatHooks.js";

interface TUIChatProps {
  // Remote mode props
  remoteUrl?: string;
  remoteToken?: string;

  // Local mode props - now optional since we'll get them from services
  configPath?: string;
  initialPrompt?: string;
  resume?: boolean;
  fork?: string;
  additionalRules?: string[];
  additionalPrompts?: string[];
}

// Custom hook to manage services
function useTUIChatServices(remoteUrl?: string) {
  const isRemoteMode = useMemo(() => !!remoteUrl, [remoteUrl]);

  const { services, allReady: allServicesReady } = useServices<{
    auth: AuthServiceState;
    config: ConfigServiceState;
    model: ModelServiceState;
    mcp: MCPServiceState;
    apiClient: ApiClientServiceState;
    update: UpdateServiceState;
    toolPermissions: ToolPermissionServiceState;
  }>([
    "auth",
    "config",
    "model",
    "mcp",
    "apiClient",
    "update",
    "toolPermissions",
  ]);

  return { services, allServicesReady, isRemoteMode };
}

// Organization names are no longer available (Hub integration removed)
function useOrganizationName(_organizationId?: string): string | undefined {
  const organizationName = undefined;

  return organizationName;
}

// Custom hook for chat handlers
function useChatHandlers(
  setShowIntroMessage: (show: boolean) => void,
  setStaticRefreshTrigger: React.Dispatch<React.SetStateAction<number>>,
) {
  // Temporary refs to avoid circular dependency
  const resetChatHistoryRef = useRef<(() => void) | null>(null);

  // Handle clearing chat and resetting intro message
  const handleClear = useCallback(() => {
    setShowIntroMessage(true);
    // Trigger static content refresh by incrementing the trigger
    setStaticRefreshTrigger((prev) => prev + 1);
  }, [setShowIntroMessage, setStaticRefreshTrigger]);

  // Service reload handlers - these will trigger reactive updates
  const handleReload = useCallback(async () => {
    // Services will automatically update the UI when they reload
    // We just need to reset chat history, intro message, and clear the screen
    if (resetChatHistoryRef.current) {
      resetChatHistoryRef.current();
    }
    setShowIntroMessage(false);
    process.stdout.write("\x1b[2J\x1b[H");
  }, [setShowIntroMessage]);

  return {
    handleClear,
    handleReload,
    resetChatHistoryRef,
  };
}

// eslint-disable-next-line complexity
const TUIChat: React.FC<TUIChatProps> = ({
  remoteUrl,
  remoteToken,
  configPath,
  initialPrompt,
  resume,
  fork,
  additionalRules,
  additionalPrompts,
}) => {
  // Use custom hook for services
  const { services, allServicesReady, isRemoteMode } =
    useTUIChatServices(remoteUrl);

  // Use navigation context
  const {
    state: navState,
    navigateTo,
    closeCurrentScreen,
    isScreenActive,
  } = useNavigation();

  // Session/config selectors replace the chat screen. Clear the previous
  // dynamic/static output before switching screens so Ink does not leave the
  // old transcript behind while the replacement is rendered.
  const clearScreenForNavigation = useCallback(() => {
    process.stdout.write("\x1b[2J\x1b[H");
  }, []);

  const navigateToScreen = useCallback(
    (screen: Parameters<typeof navigateTo>[0], data?: any) => {
      if (screen !== navState.currentScreen) {
        clearScreenForNavigation();
      }
      navigateTo(screen, data);
    },
    [clearScreenForNavigation, navigateTo, navState.currentScreen],
  );

  const closeScreen = useCallback(() => {
    if (navState.currentScreen !== "chat") {
      clearScreenForNavigation();
    }
    closeCurrentScreen();
  }, [clearScreenForNavigation, closeCurrentScreen, navState.currentScreen]);

  // Use intro message hook
  const [showIntroMessage, setShowIntroMessage] = useIntroMessage(
    isRemoteMode,
    services,
    allServicesReady,
  );

  // State to trigger static content refresh for /clear command
  const [staticRefreshTrigger, setStaticRefreshTrigger] = useState(0);

  // Use chat handlers hook
  const { handleClear, handleReload, resetChatHistoryRef } = useChatHandlers(
    setShowIntroMessage,
    setStaticRefreshTrigger,
  );

  // State for diff content overlay
  const [diffContent, setDiffContent] = useState<string>("");

  // State for temporary status message
  const [statusMessage, setStatusMessage] = useState<string>("");

  // Handler to show diff overlay
  const handleShowDiff = useCallback(
    (content: string) => {
      setDiffContent(content);
      navigateToScreen("diff");
    },
    [navigateToScreen],
  );

  // Handler to show temporary status message
  const handleShowStatusMessage = useCallback((message: string) => {
    setStatusMessage(message);
    // Clear after 3 seconds
    setTimeout(() => {
      setStatusMessage("");
    }, 3000);
  }, []);

  const {
    chatHistory,
    setChatHistory,
    isWaitingForResponse,
    responseStartTime,
    isCompacting,
    compactionStartTime,
    inputMode,
    activePermissionRequest,
    activeQuizQuestion,
    wasInterrupted,
    queuedMessages,
    handleUserMessage,
    handleInterrupt,
    handleFileAttached,
    resetChatHistory,
    handleEditMessage,
    handleToolPermissionResponse,
    handleQuizAnswer,
    loadSelectedSession,
  } = useChat({
    assistant: services.config?.config || undefined,
    model: services.model?.model || undefined,
    llmApi: services.model?.llmApi || undefined,
    initialPrompt,
    resume,
    fork,
    additionalRules,
    additionalPrompts,
    onShowConfigSelector: () => navigateToScreen("config"),
    onShowModelSelector: () => navigateToScreen("model"),
    onShowMCPSelector: () => navigateToScreen("mcp"),
    onShowUpdateSelector: () => navigateToScreen("update"),
    onShowSessionSelector: () => navigateToScreen("session"),
    onShowJobsSelector: () => navigateToScreen("jobs"),
    onShowExportSelector: () => navigateToScreen("export"),
    onReload: handleReload,
    onClear: handleClear,
    onRefreshStatic: () => setStaticRefreshTrigger((prev) => prev + 1),
    // Remote mode configuration
    isRemoteMode,
    remoteUrl,
    remoteToken,
    onShowDiff: handleShowDiff,
    onShowStatusMessage: handleShowStatusMessage,
  });

  // Update ref after useChat returns
  useEffect(() => {
    resetChatHistoryRef.current = resetChatHistory;
  }, [resetChatHistory]);

  // Memoize the chat history conversion to avoid expensive recalculation on every render

  // Calculate context percentage
  const contextData = useContextPercentage({
    chatHistory,
    model: services.model?.model || undefined,
  });

  const { renderMessage } = useMessageRenderer();

  const { handleConfigSelect, handleModelSelect } = useSelectors(
    configPath,
    setChatHistory,
    handleClear,
    setStaticRefreshTrigger,
  );

  // Session selection handler
  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      const loaded = await loadSelectedSession(sessionId);
      if (loaded) {
        setShowIntroMessage(false);
        closeScreen();
      }
    },
    [closeScreen, loadSelectedSession, setShowIntroMessage],
  );

  // Export session handler
  const handleExportSession = useCallback(
    async (sessionId: string) => {
      try {
        const { loadSessionById } = await import("../session.js");
        const fs = await import("fs");
        const path = await import("path");

        const session = loadSessionById(sessionId);
        if (!session) {
          setChatHistory((prev) => [
            ...prev,
            {
              message: {
                role: "system",
                content: `Failed to export: Session ${sessionId} not found`,
              },
              contextItems: [],
            },
          ]);
          closeScreen();
          return;
        }

        const exportPayload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          session,
        };

        const defaultPath = path.join(
          process.cwd(),
          `continue-session-${session.sessionId}.json`,
        );
        const jsonOutput = JSON.stringify(exportPayload, null, 2);
        fs.writeFileSync(defaultPath, jsonOutput, "utf-8");

        setChatHistory((prev) => [
          ...prev,
          {
            message: {
              role: "system",
              content: `Session exported to ${defaultPath}`,
            },
            contextItems: [],
          },
        ]);
        closeScreen();
      } catch (error: any) {
        setChatHistory((prev) => [
          ...prev,
          {
            message: {
              role: "system",
              content: `Failed to export session: ${error.message}`,
            },
            contextItems: [],
          },
        ]);
        closeScreen();
      }
    },
    [closeScreen, setChatHistory],
  );

  // Determine if input should be disabled
  // Allow input even when services are loading, but disable for UI overlays
  const isInputDisabled =
    navState.currentScreen !== "chat" ||
    !!activePermissionRequest ||
    !!activeQuizQuestion;

  // Check if verbose mode is enabled for resource debugging
  const isVerboseMode = useMemo(() => process.argv.includes("--verbose"), []);

  // State for image in clipboard status
  const [hasImageInClipboard, setHasImageInClipboard] = useState(false);

  // Fetch organization name based on auth state
  const organizationName = useOrganizationName(services.auth?.organizationId);

  // Track if a Bash tool is currently running via events
  const [isBashToolRunning, setIsBashToolRunning] = useState(false);

  useEffect(() => {
    const handleStarted = () => setIsBashToolRunning(true);
    const handleEnded = () => setIsBashToolRunning(false);

    bashToolEvents.on("started", handleStarted);
    bashToolEvents.on("ended", handleEnded);

    return () => {
      bashToolEvents.off("started", handleStarted);
      bashToolEvents.off("ended", handleEnded);
    };
  }, []);

  const screenContent = (
    <ScreenContent
      isScreenActive={isScreenActive}
      services={services}
      handleConfigSelect={handleConfigSelect}
      handleModelSelect={handleModelSelect}
      handleSessionSelect={handleSessionSelect}
      handleExportSession={handleExportSession}
      handleReload={handleReload}
      closeCurrentScreen={closeScreen}
      activePermissionRequest={activePermissionRequest}
      activeQuizQuestion={activeQuizQuestion}
      handleToolPermissionResponse={handleToolPermissionResponse}
      handleQuizAnswer={handleQuizAnswer}
      handleUserMessage={handleUserMessage}
      isWaitingForResponse={isWaitingForResponse}
      isCompacting={isCompacting}
      inputMode={inputMode}
      handleInterrupt={handleInterrupt}
      handleFileAttached={handleFileAttached}
      isInputDisabled={isInputDisabled}
      wasInterrupted={wasInterrupted}
      isRemoteMode={isRemoteMode}
      onImageInClipboardChange={setHasImageInClipboard}
      diffContent={diffContent}
      chatHistory={chatHistory}
      handleEditMessage={handleEditMessage}
      onShowEditSelector={() => navigateToScreen("edit")}
    />
  );

  const isChatScreen = navState.currentScreen === "chat";

  return (
    <Box flexDirection="column" height="100%">
      {/* Main content area: transcript in chat, selector/overlay otherwise */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden" marginX={1}>
        {isChatScreen ? (
          <StaticChatContent
            showIntroMessage={showIntroMessage && !isRemoteMode}
            config={services.config?.config || undefined}
            model={services.model?.model || undefined}
            mcpService={services.mcp?.mcpService || undefined}
            organizationName={organizationName}
            chatHistory={chatHistory}
            queuedMessages={queuedMessages}
            renderMessage={renderMessage}
            refreshTrigger={staticRefreshTrigger}
          />
        ) : (
          screenContent
        )}
      </Box>

      {/* Chat controls stay fixed below the transcript */}
      {isChatScreen && (
        <Box flexDirection="column" flexShrink={0} marginX={1}>
          {/* Status */}
          <ActionStatus
            visible={isWaitingForResponse && !!responseStartTime}
            startTime={responseStartTime || 0}
            message=""
            showSpinner={true}
            additionalHint={
              isBashToolRunning ? "ctrl+b to background" : undefined
            }
          />

          {/* Compaction Status */}
          <ActionStatus
            visible={isCompacting && !!compactionStartTime}
            startTime={compactionStartTime || 0}
            message="Compacting history"
            showSpinner={true}
            loadingColor="grey"
          />

          {/* Temporary status message */}
          {statusMessage && (
            <Box paddingY={0}>
              <Text color="green">{statusMessage}</Text>
            </Box>
          )}

          {/* Chat-screen input and permission content */}
          {screenContent}

          {/* Resource debug bar - only in verbose mode */}
          {isVerboseMode && !isRemoteMode && (
            <ResourceDebugBar visible={navState.currentScreen === "chat"} />
          )}

          {/* Bottom status bar */}
          <BottomStatusBar
            currentMode={services?.toolPermissions?.currentMode ?? "normal"}
            remoteUrl={remoteUrl}
            isRemoteMode={isRemoteMode}
            services={services}
            navState={navState}
            navigateTo={navigateToScreen}
            closeCurrentScreen={closeScreen}
            contextPercentage={contextData?.percentage}
            hasImageInClipboard={hasImageInClipboard}
            isVerboseMode={isVerboseMode}
            totalCost={getTotalSessionCost()}
          />
        </Box>
      )}
    </Box>
  );
};

export { TUIChat };
