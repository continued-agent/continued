import { type AssistantConfig } from "@continuedev/sdk";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import {
  getAllSlashCommands,
  type SlashCommand,
} from "../commands/commands.js";

import { useTerminalSize } from "./hooks/useTerminalSize.js";

const truncateDescription = (
  description: string,
  maxLength: number,
): string => {
  if (description.length <= maxLength) {
    return description;
  }
  return Array.from(description).slice(0, maxLength).join("").trim() + "…";
};

interface SlashCommandUIProps {
  assistant?: AssistantConfig;
  filter: string;
  selectedIndex: number;
}

const SlashCommandUI: React.FC<SlashCommandUIProps> = ({
  assistant,
  filter,
  selectedIndex,
}) => {
  const { columns } = useTerminalSize();
  const [allCommands, setAllCommands] = useState<SlashCommand[]>(
    // Fallback - basic commands without assistant
    [
      { name: "help", description: "Show help message", category: "system" },
      {
        name: "clear",
        description: "Clear the chat history",
        category: "system",
      },
      { name: "exit", description: "Exit the chat", category: "system" },
    ],
  );

  useEffect(() => {
    let stale = false;

    const loadCommands = async () => {
      if (assistant) {
        const commands = await getAllSlashCommands(assistant);
        if (!stale) {
          setAllCommands(commands);
        }
      }
    };

    void loadCommands();

    return () => {
      stale = true;
    };
  }, [assistant?.prompts, assistant?.rules]);

  // Filter commands based on the current filter
  const filteredCommands = allCommands
    .filter((cmd) => cmd.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      const aStartsWith = a.name.toLowerCase().startsWith(filter.toLowerCase());
      const bStartsWith = b.name.toLowerCase().startsWith(filter.toLowerCase());

      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      return a.name.localeCompare(b.name);
    });

  if (filteredCommands.length === 0) {
    return (
      <Box
        paddingX={1}
        marginBottom={1}
        borderStyle="single"
        borderColor="gray"
      >
        <Text color="gray">No matching commands found</Text>
      </Box>
    );
  }

  return (
    <Box
      paddingX={1}
      marginBottom={1}
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
    >
      {filteredCommands.map((command, index) => {
        const isSelected = index === selectedIndex;
        const maxCommandLength = Math.max(
          ...filteredCommands.map((cmd) => cmd.name.length),
        );
        const maxDescriptionLength = Math.max(
          8,
          Math.min(80, columns - maxCommandLength - 12),
        );

        // Find the longest command name to vertically align command descriptions
        const paddedCommandName = `/${command.name}`.padEnd(
          maxCommandLength + 1,
        );

        return (
          <Box key={command.name}>
            <Text
              color={isSelected ? "cyan" : undefined}
              bold={isSelected}
              wrap="truncate-end"
            >
              {"  "}
              {paddedCommandName}
              <Text color={isSelected ? "cyan" : "gray"}>
                {"    "}
                {truncateDescription(command.description, maxDescriptionLength)}
              </Text>
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          ↑/↓ to navigate, Enter to select, Tab to complete
        </Text>
      </Box>
    </Box>
  );
};

export { SlashCommandUI };
