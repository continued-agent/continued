export interface FetchedModel {
  name: string;
  modelId?: string;
  description?: string;
  icon?: string;
  contextLength?: number;
  maxTokens?: number;
  supportsTools?: boolean;
}

interface OpenRouterModel {
  id?: string;
  name?: string;
  context_length?: number;
  top_provider?: { max_completion_tokens?: number };
  supported_parameters?: string[];
}

interface GeminiModel {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

interface AnthropicModel {
  id?: string;
  display_name?: string;
  max_input_tokens?: number;
  max_tokens?: number;
}

interface OpenAICompatibleModel {
  id?: string;
  name?: string;
}

interface OpenAICompatibleModelsResponse {
  data?: OpenAICompatibleModel[];
}

const DEFAULT_API_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1/",
  cerebras: "https://api.cerebras.ai/v1/",
  clawrouter: "http://localhost:1337/v1/",
  cometapi: "https://api.cometapi.com/v1/",
  deepinfra: "https://api.deepinfra.com/v1/openai/",
  deepseek: "https://api.deepseek.com/",
  docker: "http://localhost:12434/engines/v1/",
  fireworks: "https://api.fireworks.ai/inference/v1/",
  "function-network": "https://api.function.network/v1/",
  groq: "https://api.groq.com/openai/v1/",
  inception: "https://api.inceptionlabs.ai/v1/",
  kindo: "https://llm.kindo.ai/v1/",
  lmstudio: "http://localhost:1234/v1/",
  lemonade: "http://localhost:8000/api/v1/",
  llamastack: "http://localhost:8321/v1/openai/v1/",
  mimo: "https://api.xiaomimimo.com/v1/",
  minimax: "https://api.minimax.io/v1/",
  mistral: "https://api.mistral.ai/v1/",
  moonshot: "https://api.moonshot.cn/v1/",
  ncompass: "https://api.ncompass.tech/v1/",
  nebius: "https://api.studio.nebius.ai/v1/",
  nous: "https://inference-api.nousresearch.com/v1/",
  novita: "https://api.novita.ai/v3/openai/",
  nvidia: "https://integrate.api.nvidia.com/v1/",
  ovhcloud: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/",
  relace: "https://instantapply.endpoint.relace.run/v1/",
  sambanova: "https://api.sambanova.ai/v1/",
  scaleway: "https://api.scaleway.ai/v1/",
  siliconflow: "https://api.siliconflow.cn/v1/",
  tars: "https://api.router.tetrate.ai/v1/",
  tensorix: "https://api.tensorix.ai/v1/",
  "text-gen-webui": "http://localhost:5000/v1/",
  together: "https://api.together.xyz/v1/",
  venice: "https://api.venice.ai/api/v1/",
  xAI: "https://api.x.ai/v1/",
  zAI: "https://api.z.ai/api/paas/v4/",
};

const OLLAMA_PROVIDERS = new Set(["ollama", "msty"]);

function getApiHeaders(apiKey?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function fetchAnthropicModels(
  apiKey?: string,
  apiBase?: string,
): Promise<FetchedModel[]> {
  const url = new URL("models", apiBase || "https://api.anthropic.com/v1/");
  url.searchParams.set("limit", "100");
  const response = await fetch(url, {
    headers: {
      "x-api-key": apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Anthropic models: ${response.status}`);
  }

  const data = (await response.json()) as { data?: AnthropicModel[] };
  return (data.data ?? [])
    .filter(
      (model): model is AnthropicModel & { id: string } =>
        typeof model.id === "string" && model.id.length > 0,
    )
    .map((model) => ({
      name: model.display_name ?? model.id,
      modelId: model.id,
      icon: "anthropic.png",
      contextLength: model.max_input_tokens,
      maxTokens: model.max_tokens,
      supportsTools: true,
    }));
}

async function fetchOllamaConfiguredModels(
  apiKey?: string,
  apiBase?: string,
): Promise<FetchedModel[]> {
  const url = new URL("api/tags", apiBase || "http://localhost:11434/");
  const response = await fetch(url, {
    headers: getApiHeaders(apiKey),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Ollama models: ${response.status}`);
  }

  const data = (await response.json()) as {
    models?: Array<{ name?: string }>;
  };
  return (data.models ?? [])
    .filter(
      (model): model is { name: string } =>
        typeof model.name === "string" && model.name.length > 0,
    )
    .map((model) => ({ name: model.name }));
}

async function fetchOpenAICompatibleModels(
  provider: string,
  apiKey?: string,
  apiBase?: string,
): Promise<FetchedModel[]> {
  const base = apiBase || DEFAULT_API_BASES[provider];
  if (!base) {
    throw new Error(
      `Dynamic model discovery is not supported for ${provider}: configure apiBase`,
    );
  }

  const response = await fetch(new URL("models", base), {
    headers: getApiHeaders(apiKey),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${provider} models: ${response.status}`);
  }

  const data = (await response.json()) as
    | OpenAICompatibleModel[]
    | OpenAICompatibleModelsResponse;
  const models = Array.isArray(data) ? data : (data.data ?? []);
  return models
    .map((model) => model.id ?? model.name)
    .filter(
      (modelId): modelId is string =>
        typeof modelId === "string" && modelId.length > 0,
    )
    .map((modelId) => ({ name: modelId }));
}

async function fetchOpenRouterModels(): Promise<FetchedModel[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenRouter models: ${response.status}`);
    }

    const data = (await response.json()) as { data?: OpenRouterModel[] };
    if (!data.data || !Array.isArray(data.data)) {
      return [];
    }

    return data.data
      .filter(
        (model): model is OpenRouterModel & { id: string; name: string } =>
          typeof model.id === "string" && typeof model.name === "string",
      )
      .map((model) => ({
        name: model.name,
        modelId: model.id,
        icon: "openrouter.png",
        contextLength: model.context_length,
        maxTokens: model.top_provider?.max_completion_tokens,
        supportsTools: (model.supported_parameters ?? []).includes("tools"),
      }));
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error(`Failed to fetch OpenRouter models: ${String(error)}`);
  }
}

async function fetchGeminiModels(
  apiKey?: string,
  apiBase?: string,
): Promise<FetchedModel[]> {
  const base = apiBase || "https://generativelanguage.googleapis.com/v1beta/";
  const url = new URL("models", base);
  const response = await fetch(url, {
    headers: apiKey
      ? { "x-goog-api-key": apiKey, "Content-Type": "application/json" }
      : undefined,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Gemini models: ${response.status}`);
  }
  const data = (await response.json()) as { models?: GeminiModel[] };
  return (data.models ?? [])
    .filter((model) => {
      const id: string = model.name?.replace("models/", "") ?? "";
      const methods: string[] = model.supportedGenerationMethods ?? [];
      return (
        !id.startsWith("gemini-2.0") &&
        !id.startsWith("gemma-") && // Gemma models are supported through Ollama, not the Gemini API
        !id.startsWith("nano-banana") &&
        !id.startsWith("lyria") &&
        methods.includes("generateContent") &&
        !methods.includes("embedContent") &&
        !methods.includes("predict") &&
        !methods.includes("predictLongRunning") &&
        !methods.includes("bidiGenerateContent") &&
        !id.includes("tts") &&
        !id.includes("image") &&
        !id.includes("robotics") &&
        !id.includes("computer-use")
      );
    })
    .map((model) => ({
      name:
        model.displayName ?? model.name?.replace("models/", "") ?? "unnamed",
      modelId: model.name?.replace("models/", ""),
      icon: "gemini.png",
      contextLength: model.inputTokenLimit,
      maxTokens: model.outputTokenLimit,
      supportsTools: true,
    }));
}

export async function fetchRemoteModels(
  provider: string,
  apiKey?: string,
  apiBase?: string,
): Promise<FetchedModel[]> {
  switch (provider) {
    case "openrouter":
      return fetchOpenRouterModels();
    case "gemini":
      return fetchGeminiModels(apiKey, apiBase);
    default:
      throw new Error(
        `Dynamic model discovery is not supported for ${provider}`,
      );
  }
}

/**
 * Fetch models using the provider endpoint configured by the user.
 *
 * This module intentionally stays independent from the provider class
 * registry. The CLI bundles it directly, so importing model discovery must
 * not pull every LLM implementation and its native dependencies into the
 * executable.
 */
export async function fetchConfiguredModels(
  provider: string,
  apiKey?: string,
  apiBase?: string,
): Promise<FetchedModel[]> {
  if (OLLAMA_PROVIDERS.has(provider)) {
    return fetchOllamaConfiguredModels(apiKey, apiBase);
  }

  switch (provider) {
    case "openrouter":
    case "gemini":
      return fetchRemoteModels(provider, apiKey, apiBase);
    case "anthropic":
      return fetchAnthropicModels(apiKey, apiBase);
    default:
      return fetchOpenAICompatibleModels(provider, apiKey, apiBase);
  }
}
