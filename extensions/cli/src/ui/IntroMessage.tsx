import type { AssistantUnrolled, ModelConfig } from "@continuedev/config-yaml";
import { Box, Text } from "ink";
import React, { useMemo } from "react";

import { getDisplayableAsciiArt } from "../asciiArt.js";
import type { MCPService } from "../services/MCPService.js";
import { isModelCapable } from "../utils/modelCapability.js";

import { ModelCapabilityWarning } from "./ModelCapabilityWarning.js";

interface IntroMessageProps {
  config?: AssistantUnrolled;
  model?: ModelConfig;
  mcpService?: MCPService;
  organizationName?: string;
}

// Helper function to extract rule names
const extractRuleNames = (rules: any[] = []): string[] => {
  return rules.map((rule: any) =>
    typeof rule === "string" ? rule : rule?.name || "Unknown",
  );
};

const IntroMessage: React.FC<IntroMessageProps> = ({
  config,
  model,
  mcpService,
  organizationName,
}) => {
  // Get MCP prompts directly (not memoized since they can change after first render)
  const mcpPrompts = mcpService?.getState().prompts ?? [];

  // Memoize expensive operations to avoid running on every resize
  const { allRules, modelCapable } = useMemo(() => {
    const allRules = extractRuleNames(config?.rules);

    // Check if model is capable - now checking both name and model properties
    const modelCapable = model
      ? isModelCapable(model.provider, model.name, model.model)
      : true; // Default to true if model not loaded yet

    return { allRules, modelCapable };
  }, [config?.rules, model?.provider, model?.name, model?.model]);

  // Render helper components
  const renderMcpPrompts = () =>
    mcpPrompts.length > 0 ? (
      <>
        <Text> </Text>
        <Text bold>Prompts:</Text>
        {mcpPrompts.map((prompt, index) => (
          <Text key={`mcp-${index}`}>
            - <Text>/{prompt.name}</Text>:{" "}
            <Text color="dim">{prompt.description}</Text>
          </Text>
        ))}
      </>
    ) : null;

  const renderRules = () =>
    allRules.length > 0 ? (
      <>
        <Text> </Text>
        <Text bold>Rules:</Text>
        {allRules.map((rule, index) => (
          <Text key={index}>
            - <Text>{rule}</Text>
          </Text>
        ))}
      </>
    ) : null;

  const renderMcpServers = () =>
    (config?.mcpServers?.length ?? 0) > 0 ? (
      <>
        <Text> </Text>
        <Text bold>MCP Servers:</Text>
        {config?.mcpServers?.map((server: any, index: number) => (
          <Text key={index}>
            - <Text>{server?.name}</Text>
          </Text>
        ))}
      </>
    ) : null;

  return (
    <Box flexDirection="column">
      {/* ASCII Art */}
      <Text>{getDisplayableAsciiArt()}</Text>
      <Text> </Text>

      <Box flexDirection="column" paddingLeft={2}>
        {/* Organization name */}
        {organizationName && (
          <Text>
            <Text bold>Org:</Text> <Text>{organizationName}</Text>
          </Text>
        )}

        {/* Agent name */}
        {config && (
          <Text>
            <Text bold>Config:</Text> <Text>{config.name}</Text>
          </Text>
        )}

        {/* Model */}
        {model ? (
          <Text>
            <Text bold>Model:</Text> <Text>{model.name.split("/").pop()}</Text>
          </Text>
        ) : (
          <Text>
            <Text bold>Model:</Text> <Text color="dim">Loading...</Text>
          </Text>
        )}

        {/* Model capability warning */}
        {model && !modelCapable && (
          <ModelCapabilityWarning
            modelName={model.name.split("/").pop() || model.name}
          />
        )}

        {renderMcpPrompts()}
        {renderRules()}
        {renderMcpServers()}
      </Box>
    </Box>
  );
};

export { IntroMessage };
