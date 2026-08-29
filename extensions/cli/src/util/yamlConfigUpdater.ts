import { parseDocument } from "yaml";

export interface ModelConfig {
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  roles: string[];
  defaultCompletionOptions?: {
    contextLength: number;
    maxTokens: number;
  };
  capabilities?: string[];
}

export interface ConfigStructure {
  name: string;
  version: string;
  schema: string;
  models: ModelConfig[];
}

export interface ProviderModelConfig {
  name: string;
  provider: string;
  model: string;
  apiKey?: string;
  apiBase?: string;
  roles: string[];
  env?: Record<string, string>;
}

// These model definitions are inlined copies of the corresponding Continue Hub
// blocks (e.g. anthropic/claude-sonnet-4-6) that onboarding previously resolved
// via `uses:` slugs. Since Hub/slug resolution has been removed, we reproduce
// the exact block contents here, with `apiKey` substituted for the block's
// `${{ inputs.*_API_KEY }}` placeholder. Keep these in sync with the explicit
// Anthropic models in core/config/onboarding.ts.
function getAnthropicModels(apiKey: string): ModelConfig[] {
  return [
    {
      name: "Claude Sonnet 4.6",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey,
      roles: ["chat", "edit", "apply"],
      defaultCompletionOptions: { contextLength: 200000, maxTokens: 64000 },
      capabilities: ["tool_use", "image_input"],
    },
    {
      name: "Claude Opus 4.6",
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKey,
      roles: ["chat", "edit", "apply"],
      defaultCompletionOptions: { contextLength: 200000, maxTokens: 64000 },
      capabilities: ["tool_use", "image_input"],
    },
  ];
}

function isManagedAnthropicModel(model: any): boolean {
  if (!model || typeof model !== "object") {
    return false;
  }
  // Drop legacy slug-based blocks (e.g. `uses: anthropic/claude-sonnet-4-6`)...
  if (typeof model.uses === "string" && model.uses.startsWith("anthropic/")) {
    return true;
  }
  // ...as well as the explicit Anthropic models we manage here.
  return (
    model.provider === "anthropic" &&
    (model.model === "claude-sonnet-4-6" || model.model === "claude-opus-4-6")
  );
}

/**
 * Adds or replaces one model in a Continue YAML configuration.
 *
 * The updater deliberately stores the API-key reference, not the secret value.
 * Local secrets are resolved later from ~/.continue/.env or process.env.
 */
export function updateProviderModelInYaml(
  yamlContent: string,
  model: ProviderModelConfig,
): string {
  let doc = parseDocument(yamlContent);
  let config: Record<string, any>;

  try {
    if (doc.errors.length > 0) {
      throw new Error("Invalid YAML");
    }

    const parsed = doc.toJS();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Configuration must be a YAML mapping");
    }
    config = parsed as Record<string, any>;
  } catch {
    doc = parseDocument("");
    config = {};
  }

  if (!config.name) {
    doc.set("name", "Main Config");
  }
  if (!config.version) {
    doc.set("version", "1.0.0");
  }
  if (!config.schema) {
    doc.set("schema", "v1");
  }

  const models = Array.isArray(config.models) ? [...config.models] : [];
  const existingModelIndex = models.findIndex(
    (existingModel) =>
      existingModel &&
      typeof existingModel === "object" &&
      existingModel.provider === model.provider &&
      existingModel.model === model.model,
  );

  if (existingModelIndex >= 0) {
    models[existingModelIndex] = model;
  } else {
    models.push(model);
  }

  doc.set("models", models);
  return doc.toString();
}

/**
 * Updates or adds explicit Anthropic Claude model configurations in a YAML
 * string while preserving comments and formatting. This is a pure function that
 * takes a YAML string and returns a modified YAML string.
 *
 * @param yamlContent - The original YAML content as a string (can be empty)
 * @param apiKey - The Anthropic API key to set
 * @returns The updated YAML content as a string with comments preserved
 */
export function updateAnthropicModelInYaml(
  yamlContent: string,
  apiKey: string,
): string {
  const newModels = getAnthropicModels(apiKey);

  try {
    const doc = parseDocument(yamlContent);

    // If document is empty or has no content, create a new config
    if (!doc.contents || doc.contents === null) {
      const defaultConfig: ConfigStructure = {
        name: "Main Config",
        version: "1.0.0",
        schema: "v1",
        models: newModels,
      };

      const newDoc = parseDocument("");
      Object.keys(defaultConfig).forEach((key) =>
        newDoc.set(key, (defaultConfig as any)[key]),
      );
      return newDoc.toString();
    }

    // Convert to JS, filter models, and recreate
    const config = doc.toJS() as any;

    // Make sure models array exists
    if (!config.models || !Array.isArray(config.models)) {
      config.models = [];
    }

    // Filter out existing Anthropic models (legacy slug blocks + managed models)
    config.models = config.models.filter(
      (model: any) => !isManagedAnthropicModel(model),
    );

    // Add the new explicit Anthropic models
    config.models.push(...newModels);

    // Update the models array while preserving comments and structure
    doc.set("models", config.models);

    return doc.toString();
  } catch {
    // If parsing fails completely, create a new config
    const defaultConfig: ConfigStructure = {
      name: "Main Config",
      version: "1.0.0",
      schema: "v1",
      models: newModels,
    };

    const doc = parseDocument("");
    Object.keys(defaultConfig).forEach((key) =>
      doc.set(key, (defaultConfig as any)[key]),
    );
    return doc.toString();
  }
}
