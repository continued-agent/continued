import { Box, Text, useInput } from "ink";
import React, { ReactNode } from "react";

import { defaultBoxStyles } from "./styles.js";

const SELECTOR_ACCENT_COLOR = "cyan";

export interface SelectorOption {
  id: string;
  name: string;
  displaySuffix?: string;
}

interface SelectorProps<T extends SelectorOption> {
  title: string;
  options: T[];
  selectedIndex: number;
  loading: boolean;
  error: string | null;
  loadingMessage?: string;
  currentId?: string | null;
  onSelect: (option: T) => void;
  onCancel: () => void;
  onNavigate: (newIndex: number) => void;
  renderOption?: (
    option: T,
    isSelected: boolean,
    isCurrent: boolean,
  ) => ReactNode;
}

export function Selector<T extends SelectorOption>({
  title,
  options,
  selectedIndex,
  loading,
  error,
  loadingMessage = "Loading...",
  currentId,
  onSelect,
  onCancel,
  onNavigate,
  renderOption,
}: SelectorProps<T>) {
  // Handle input for loading and error states
  useInput((input, key) => {
    if (loading || error) {
      if (key.escape || (key.ctrl && input === "c")) {
        onCancel();
        return;
      }
    }
  });

  useInput((input, key) => {
    if (loading || error) return; // Skip normal input handling during loading/error

    if (key.escape || (key.ctrl && input === "c")) {
      onCancel();
      return;
    }

    if (key.return) {
      const selectedOption = options[selectedIndex];
      if (selectedOption) {
        onSelect(selectedOption);
      }
      return;
    }

    // loop back to the first option after the last option, and vice versa
    if (key.upArrow) {
      onNavigate(selectedIndex === 0 ? options.length - 1 : selectedIndex - 1);
    } else if (key.downArrow) {
      onNavigate(selectedIndex === options.length - 1 ? 0 : selectedIndex + 1);
    }
  });

  if (loading) {
    return (
      <Box
        {...defaultBoxStyles(SELECTOR_ACCENT_COLOR)}
        width="100%"
        minWidth={0}
      >
        <Text color={SELECTOR_ACCENT_COLOR} bold wrap="truncate-end">
          {title}
        </Text>
        <Text> </Text>
        <Text italic color="gray" wrap="truncate-end">
          {loadingMessage}
        </Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        {...defaultBoxStyles(SELECTOR_ACCENT_COLOR)}
        width="100%"
        minWidth={0}
      >
        <Text color="red" bold>
          Error
        </Text>
        <Text color="red" wrap="truncate-end">
          {error}
        </Text>
        <Text color="gray" dimColor>
          Press Esc to cancel
        </Text>
      </Box>
    );
  }

  const defaultRenderOption = (
    option: T,
    isSelected: boolean,
    isCurrent: boolean,
  ) => (
    <>
      <Text
        color={
          isSelected ? SELECTOR_ACCENT_COLOR : isCurrent ? "green" : undefined
        }
        bold={isSelected}
        wrap="truncate-end"
      >
        {isSelected ? "➤ " : "  "}
        {option.name}
        {option.displaySuffix || ""}
      </Text>
      {isCurrent && (
        <Text bold color="green">
          {" ✔"}
        </Text>
      )}
    </>
  );

  return (
    <Box {...defaultBoxStyles(SELECTOR_ACCENT_COLOR)} width="100%" minWidth={0}>
      <Text color={SELECTOR_ACCENT_COLOR} bold wrap="truncate-end">
        {title}
      </Text>
      <Box flexDirection="column" marginTop={1} width="100%" minWidth={0}>
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          const isCurrent = currentId === option.id;
          const render = renderOption || defaultRenderOption;

          return (
            <Box key={option.id} width="100%" minWidth={0}>
              {render(option, isSelected, isCurrent)}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1} width="100%" minWidth={0}>
        <Text color="gray" dimColor wrap="truncate-end">
          ↑/↓ to navigate, Enter to select, Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
