/**
 * Providers shown by the first-run CLI setup.
 *
 * Provider IDs intentionally match the IDs understood by Continue's model
 * adapters. Providers without a native Continue adapter use the generic
 * OpenAI-compatible adapter and provide an explicit base URL where one is
 * known.
 */
export interface OnboardingProvider {
  id: string;
  label: string;
  provider: string;
  model: string;
  apiKeyEnv?: string;
  apiBase?: string;
  description: string;
  apiKeyOptional?: boolean;
  requiresCustomApiBase?: boolean;
  requiresCustomModel?: boolean;
  requiresAzureSettings?: boolean;
  requiresBedrockSettings?: boolean;
}

export const ONBOARDING_PROVIDERS: OnboardingProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    provider: "openai",
    model: "gpt-4.1-mini",
    apiKeyEnv: "OPENAI_API_KEY",
    description: "GPT models for general coding and chat",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    description: "Claude models with strong reasoning and long context",
  },
  {
    id: "google",
    label: "Google Gemini",
    provider: "gemini",
    model: "gemini-2.5-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    description: "Fast multimodal Gemini models",
  },
  {
    id: "meta",
    label: "Meta Llama (Together AI)",
    provider: "openai",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    apiKeyEnv: "TOGETHER_API_KEY",
    apiBase: "https://api.together.xyz/v1",
    description: "Llama models through Together's OpenAI-compatible API",
  },
  {
    id: "xai",
    label: "xAI",
    provider: "xAI",
    model: "grok-3-mini",
    apiKeyEnv: "XAI_API_KEY",
    description: "Grok models from xAI",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    provider: "mistral",
    model: "mistral-large-latest",
    apiKeyEnv: "MISTRAL_API_KEY",
    description: "Mistral's hosted coding and chat models",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    provider: "deepseek",
    model: "deepseek-chat",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    description: "DeepSeek's coding and reasoning models",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4-5",
    apiKeyEnv: "OPENROUTER_API_KEY",
    apiBase: "https://openrouter.ai/api/v1",
    description: "A gateway to models from many providers",
  },
  {
    id: "perplexity",
    label: "Perplexity AI (OpenAI-compatible)",
    provider: "openai",
    model: "sonar-pro",
    apiKeyEnv: "PERPLEXITY_API_KEY",
    apiBase: "https://api.perplexity.ai",
    description: "Perplexity's Sonar models through its compatible API",
  },
  {
    id: "litellm",
    label: "LiteLLM (OpenAI-compatible)",
    provider: "openai",
    model: "your-model",
    apiKeyEnv: "LITELLM_API_KEY",
    apiBase: "http://localhost:4000/v1",
    description:
      "Route through a LiteLLM proxy; base URL and model are editable",
    requiresCustomApiBase: true,
    requiresCustomModel: true,
  },
  {
    id: "opencode-zen",
    label: "OpenCode Zen (OpenAI-compatible)",
    provider: "openai",
    model: "claude-sonnet-4-5",
    apiKeyEnv: "OPENCODE_API_KEY",
    apiBase: "https://opencode.ai/zen/v1",
    description: "OpenCode Zen through its compatible API",
    requiresCustomModel: true,
  },
  {
    id: "azure",
    label: "Microsoft Azure AI",
    provider: "azure",
    model: "gpt-4o",
    apiKeyEnv: "AZURE_OPENAI_API_KEY",
    description: "Azure OpenAI deployments",
    requiresAzureSettings: true,
  },
  {
    id: "bedrock",
    label: "AWS Bedrock",
    provider: "bedrock",
    model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    apiKeyEnv: "AWS_BEDROCK_API_KEY",
    description: "Use AWS IAM credentials or an optional Bedrock API key",
    apiKeyOptional: true,
    requiresBedrockSettings: true,
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    provider: "nvidia",
    model: "meta/llama-3.1-70b-instruct",
    apiKeyEnv: "NVIDIA_API_KEY",
    description: "Hosted open models through NVIDIA NIM",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    provider: "huggingface-inference-api",
    model: "meta-llama/Llama-3.1-8B-Instruct",
    apiKeyEnv: "HUGGINGFACE_API_KEY",
    apiBase: "https://router.huggingface.co/v1/",
    description:
      "Hugging Face Inference Providers via the OpenAI-compatible router",
    requiresCustomModel: true,
  },
  {
    id: "custom",
    label: "Custom provider (OpenAI-compatible)",
    provider: "openai",
    model: "custom-model",
    apiKeyEnv: "CUSTOM_PROVIDER_API_KEY",
    description: "Connect to any OpenAI-compatible endpoint",
    requiresCustomApiBase: true,
    requiresCustomModel: true,
  },
];
