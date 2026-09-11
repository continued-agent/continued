import { Box } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import type { ChatHistoryItem } from "../../../../../core/index.js";

import { MemoizedMessage } from "./MemoizedMessage.js";
import { StaticChatContent } from "./StaticChatContent.js";

const createMessage = (
  role: "user" | "assistant",
  content: string,
): ChatHistoryItem => ({
  message: { role, content },
  contextItems: [],
});

describe("StaticChatContent", () => {
  it("keeps static and pending messages on the same content inset", async () => {
    const { lastFrame } = render(
      <Box marginX={1}>
        <StaticChatContent
          showIntroMessage={false}
          chatHistory={[
            createMessage("user", "First message"),
            createMessage("assistant", "Second message"),
          ]}
          renderMessage={(item, index) => (
            <MemoizedMessage key={index} item={item} index={index} />
          )}
        />
      </Box>,
    );

    await new Promise((resolve) => setImmediate(resolve));

    const lines = (lastFrame() ?? "").split("\n");
    expect(lines[0]).toBe(" › First message");
    expect(lines[2]).toBe(" ● Second message");
  });
});
