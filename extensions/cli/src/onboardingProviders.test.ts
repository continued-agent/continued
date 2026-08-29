import { describe, expect, it } from "vitest";

import { ONBOARDING_PROVIDERS } from "./onboardingProviders.js";

describe("ONBOARDING_PROVIDERS", () => {
  it("includes every requested provider choice", () => {
    expect(ONBOARDING_PROVIDERS.map((provider) => provider.id)).toEqual([
      "openai",
      "anthropic",
      "google",
      "meta",
      "xai",
      "mistral",
      "deepseek",
      "openrouter",
      "perplexity",
      "litellm",
      "opencode-zen",
      "azure",
      "bedrock",
      "nvidia",
      "huggingface",
      "custom",
    ]);
  });

  it("uses generic OpenAI-compatible routes for non-native choices", () => {
    for (const id of [
      "meta",
      "perplexity",
      "litellm",
      "opencode-zen",
      "custom",
    ]) {
      expect(
        ONBOARDING_PROVIDERS.find((provider) => provider.id === id)?.provider,
      ).toBe("openai");
    }
  });

  it("uses the adapter's case-sensitive native IDs", () => {
    expect(
      ONBOARDING_PROVIDERS.find((provider) => provider.id === "xai")?.provider,
    ).toBe("xAI");
    expect(
      ONBOARDING_PROVIDERS.find((provider) => provider.id === "huggingface")
        ?.provider,
    ).toBe("huggingface-inference-api");
  });
});
