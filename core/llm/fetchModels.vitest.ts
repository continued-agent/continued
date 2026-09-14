import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fetchModels } from "./fetchModels";

describe("fetchModels", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("fetches OpenRouter models from the public models endpoint", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "openai/gpt-4.1-mini",
              name: "GPT-4.1 Mini",
              supported_parameters: ["tools"],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(fetchModels("openrouter")).resolves.toEqual([
      expect.objectContaining({
        name: "GPT-4.1 Mini",
        modelId: "openai/gpt-4.1-mini",
        supportsTools: true,
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
    );
  });

  test("lists Gemini generateContent models with the API key header", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-2.5-flash",
              displayName: "Gemini 2.5 Flash",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/text-embedding-004",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(
      fetchModels("gemini", "gemini-secret", "https://gemini.example/v1beta/"),
    ).resolves.toEqual([
      expect.objectContaining({
        name: "Gemini 2.5 Flash",
        modelId: "gemini-2.5-flash",
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://gemini.example/v1beta/models"),
      {
        headers: {
          "x-goog-api-key": "gemini-secret",
          "Content-Type": "application/json",
        },
      },
    );
  });

  test("surfaces an OpenRouter HTTP error to the caller", async () => {
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(fetchModels("openrouter")).rejects.toThrow(
      "Failed to fetch OpenRouter models: 503",
    );
  });
});
