import { fetchwithRequestOptions } from "@continuedev/fetch";
import * as openAiAdapters from "@continuedev/openai-adapters";
import * as dotenv from "dotenv";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ChatMessage, ILLM } from "..";
import Anthropic from "./llms/Anthropic";
import Gemini from "./llms/Gemini";
import OpenAI from "./llms/OpenAI";

dotenv.config();

vi.mock("@continuedev/fetch");
vi.mock("@continuedev/openai-adapters");

async function dudLLMCall(llm: ILLM, messages: ChatMessage[]) {
  try {
    const abortController = new AbortController();
    const gen = llm.streamChat(messages, abortController.signal, {});
    await gen.next();
    await gen.return({
      completion: "",
      modelTitle: "",
      modelProvider: "",
      prompt: "",
    });
    abortController.abort();
  } catch (e) {
    console.error("Expected error", e);
  }
}

const invalidToolCallArg = '{"name": "Ali';
const messagesWithInvalidToolCallArgs: ChatMessage[] = [
  {
    role: "user",
    content: "Call the say_hello tool",
  },
  {
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "tool_call_1",
        type: "function",
        function: {
          name: "say_name",
          arguments: invalidToolCallArg,
        },
      },
    ],
  },
  {
    role: "user",
    content: "This is my response",
  },
];

describe("LLM Pre-fetch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Mock getAnthropicHeaders to return fake headers
    vi.mocked(openAiAdapters.getAnthropicHeaders).mockReturnValue({
      fake: "headers",
    });
    // Log to verify the mock is properly set up
    console.log("Mock setup:", openAiAdapters);
  });

  test("Invalid tool call args are ignored", async () => {
    const anthropic = new Anthropic({
      model: "not-important",
      apiKey: "invalid",
    });
    await dudLLMCall(anthropic, messagesWithInvalidToolCallArgs);
    expect(fetchwithRequestOptions).toHaveBeenCalledWith(
      expect.any(URL),
      {
        method: "POST",
        headers: expect.any(Object),
        signal: expect.any(AbortSignal),
        body: expect.stringContaining('"name":"say_name","input":{}'),
      },
      expect.any(Object),
    );

    vi.clearAllMocks();
    const gemini = new Gemini({ model: "gemini-something", apiKey: "invalid" });
    await dudLLMCall(gemini, messagesWithInvalidToolCallArgs);
    const geminiCall = vi.mocked(fetchwithRequestOptions).mock.calls[0];
    expect(geminiCall[0]).toBeInstanceOf(URL);
    // The API key must not leak into the request URL (it is sent via header).
    expect(geminiCall[0].toString()).not.toContain("key=");
    expect(geminiCall[1]).toMatchObject({
      method: "POST",
      body: expect.stringContaining('"name":"say_name","args":{}'),
      headers: {
        "x-goog-api-key": "invalid",
        "Content-Type": "application/json",
      },
    });

    // OPENAI DOES NOT NEED TO CLEAR INVALID TOOL CALL ARGS BECAUSE IT STORES THEM IN STRINGS
    vi.clearAllMocks();
    const openai = new OpenAI({ model: "gpt-something", apiKey: "invalid" });
    await dudLLMCall(openai, messagesWithInvalidToolCallArgs);
    expect(fetchwithRequestOptions).toHaveBeenCalledWith(
      expect.any(URL),
      {
        method: "POST",
        headers: expect.any(Object),
        signal: expect.any(AbortSignal),
        body: expect.stringContaining(JSON.stringify(invalidToolCallArg)),
      },
      expect.any(Object),
    );
  });
});
