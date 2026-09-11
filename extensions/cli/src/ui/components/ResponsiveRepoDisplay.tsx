import { Box, Text } from "ink";
import React, { useMemo } from "react";

import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { getResponsiveRepoText } from "../hooks/useTUIChatHooks.js";

interface ResponsiveRepoDisplayProps {
  remoteUrl?: string;
  reservedWidth?: number; // Width reserved for other elements in the same row
}

export const ResponsiveRepoDisplay: React.FC<ResponsiveRepoDisplayProps> = ({
  remoteUrl,
  reservedWidth,
}) => {
  const { columns } = useTerminalSize();

  const repoText = useMemo(() => {
    // Calculate available width for repo display
    // Reserve space for margins, mode indicator, context percentage, and other UI elements
    const availableWidth = reservedWidth ?? Math.floor(columns / 2);

    return getResponsiveRepoText(remoteUrl, availableWidth);
  }, [remoteUrl, columns, reservedWidth]);

  // Don't render if no text to show
  if (!repoText) {
    return null;
  }

  return (
    <Box flexShrink={1} minWidth={0}>
      <Text color="dim" wrap="truncate-start">
        {repoText}
      </Text>
    </Box>
  );
};
