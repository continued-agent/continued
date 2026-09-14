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
