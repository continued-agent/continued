import { constructLlmApi, type LLMConfig } from "@continuedev/openai-adapters";
import { describe, expect, it } from "vitest";

import {
  ONBOARDING_PROVIDERS,
  type OnboardingProvider,
} from "./onboardingProviders.js";

function createAdapterConfig(provider: OnboardingProvider): LLMConfig {
  return {
    provider: provider.provider,
    model: provider.model,
    apiKey: "test-api-key",
    apiBase:
      provider.apiBase ??
      (provider.requiresAzureSettings
        ? "https://example.openai.azure.com"
        : undefined),
    env: provider.requiresAzureSettings
      ? {
          apiType: "azure-openai",
          deployment: "test-deployment",
          apiVersion: "2024-10-21",
        }
      : provider.requiresBedrockSettings
        ? { region: "us-east-1" }
        : undefined,
  } as LLMConfig;
}

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

  it("constructs an adapter for every provider without making a network request", () => {
    for (const provider of ONBOARDING_PROVIDERS) {
      expect(() =>
        constructLlmApi(createAdapterConfig(provider)),
      ).not.toThrow();
      expect(constructLlmApi(createAdapterConfig(provider))).toBeDefined();
    }
  });

  it("uses a current OpenAI-compatible Zen model by default", () => {
    const zen = ONBOARDING_PROVIDERS.find(
      (provider) => provider.id === "opencode-zen",
    );

    expect(zen).toMatchObject({
      provider: "openai",
      model: "qwen3.6-plus",
      apiBase: "https://opencode.ai/zen/v1",
      apiKeyEnv: "OPENCODE_API_KEY",
    });
  });
});
