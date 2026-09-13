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
    expect(lines[0]).toBe("   › First message");
    expect(lines[2]).toBe("   ● Second message");
  });

  it("separates intro metadata from the first chat message", async () => {
    const { lastFrame } = render(
      <Box marginX={1}>
        <StaticChatContent
          showIntroMessage
          config={{ name: "Main Config", version: "1.0.0", rules: [] }}
          model={{
            name: "Google Gemini",
            provider: "gemini",
            model: "gemini-2.5-flash",
          }}
          chatHistory={[createMessage("user", "Salut")]}
          renderMessage={(item, index) => (
            <MemoizedMessage key={index} item={item} index={index} />
          )}
        />
      </Box>,
    );

    await new Promise((resolve) => setImmediate(resolve));

    const lines = (lastFrame() ?? "").split("\n");
    const modelLine = lines.findIndex((line) =>
      line.includes("Model: Google Gemini"),
    );

    expect(modelLine).toBeGreaterThanOrEqual(0);
    expect(lines[modelLine + 1]).toBe("");
    expect(lines[modelLine + 2]).toBe("   › Salut");
  });
});
