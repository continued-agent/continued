import { Box, render, Text, useInput } from "ink";
import React, { useMemo } from "react";

import {
  ONBOARDING_PROVIDERS,
  OnboardingProvider,
} from "../onboardingProviders.js";

import { useTerminalSize } from "./hooks/useTerminalSize.js";

interface ProviderSelectorProps {
  options?: OnboardingProvider[];
  onSelect: (provider: OnboardingProvider) => void;
  onCancel: () => void;
}

export function ProviderSelector({
  options = ONBOARDING_PROVIDERS,
  onSelect,
  onCancel,
}: ProviderSelectorProps) {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const { rows } = useTerminalSize();

  const visibleCount = Math.max(4, Math.min(options.length, rows - 8));
  const { visibleOptions, offset } = useMemo(() => {
    if (options.length <= visibleCount) {
      return { visibleOptions: options, offset: 0 };
    }

    const nextOffset = Math.min(
      Math.max(0, selectedIndex - visibleCount + 1),
      options.length - visibleCount,
    );

    return {
      visibleOptions: options.slice(nextOffset, nextOffset + visibleCount),
      offset: nextOffset,
    };
  }, [options, selectedIndex, visibleCount]);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) {
      onCancel();
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex((current) =>
        current === 0 ? options.length - 1 : current - 1,
      );
      return;
    }

    if (key.downArrow || input === "j") {
      setSelectedIndex((current) =>
        current === options.length - 1 ? 0 : current + 1,
      );
      return;
    }

    if (key.return && options[selectedIndex]) {
      onSelect(options[selectedIndex]);
    }
  });

  const hasMoreAbove = offset > 0;
  const hasMoreBelow = offset + visibleOptions.length < options.length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="blue">
        Choose a model provider
      </Text>
      <Text color="gray">
        ↑/↓ to navigate, Enter to select, Esc to cancel ({selectedIndex + 1}/
        {options.length})
      </Text>

      {hasMoreAbove && (
        <Text color="gray" dimColor>
          ↑ more providers above
        </Text>
      )}

      {visibleOptions.map((option, index) => {
        const isSelected = index + offset === selectedIndex;
        return (
          <Box key={option.id}>
            <Text color={isSelected ? "blue" : "white"} bold={isSelected}>
              {isSelected ? "➤ " : "  "}
              {option.label}
            </Text>
          </Box>
        );
      })}

      {hasMoreBelow && (
        <Text color="gray" dimColor>
          ↓ more providers below
        </Text>
      )}
    </Box>
  );
}

/** Run the provider picker and resolve with the selected provider. */
export function selectOnboardingProvider(
  options: OnboardingProvider[] = ONBOARDING_PROVIDERS,
): Promise<OnboardingProvider | null> {
  return new Promise((resolve) => {
    const app = render(
      React.createElement(ProviderSelector, {
        options,
        onSelect: (provider: OnboardingProvider) => {
          app.unmount();
          resolve(provider);
        },
        onCancel: () => {
          app.unmount();
          resolve(null);
        },
      }),
      { exitOnCtrlC: false },
    );
  });
}
