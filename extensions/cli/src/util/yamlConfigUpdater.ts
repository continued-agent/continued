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
  capabilities?: string[];
  env?: Record<string, string>;
}

export interface UpdateProviderModelOptions {
  /** Put the selected model first so it is the default chat model. */
  prepend?: boolean;
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
  options: UpdateProviderModelOptions = {},
): string {
  const doc = parseDocument(yamlContent);
  let config: Record<string, any>;

  try {
    if (doc.errors.length > 0) {
      throw new Error("Invalid YAML");
    }

    const parsed = doc.toJS();
    if (parsed === null && yamlContent.trim() === "") {
      config = {};
    } else if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Configuration must be a YAML mapping");
    } else {
      config = parsed as Record<string, any>;
    }
  } catch (error) {
    throw new Error(
      `Cannot update invalid YAML configuration: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  if ("models" in config && config.models !== undefined) {
    if (!Array.isArray(config.models)) {
      throw new Error("Cannot update configuration: models must be an array");
    }
    if (
      config.models.some(
        (existingModel: unknown) =>
          !existingModel ||
          typeof existingModel !== "object" ||
          Array.isArray(existingModel),
      )
    ) {
      throw new Error(
        "Cannot update configuration: every model must be a mapping",
      );
    }
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
    const existingModel = models[existingModelIndex];
    const updatedModel = { ...existingModel, ...model };

    // These fields are managed by onboarding. Do not retain stale values when
    // the newly selected provider deliberately omits them.
    for (const field of ["apiKey", "apiBase", "env"]) {
      if (!(field in model)) {
        delete updatedModel[field];
      }
    }

    if (options.prepend && existingModelIndex > 0) {
      models.splice(existingModelIndex, 1);
      models.unshift(updatedModel);
    } else {
      models[existingModelIndex] = updatedModel;
    }
  } else if (options.prepend) {
    models.unshift(model);
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

  const doc = parseDocument(yamlContent);
  if (doc.errors.length > 0) {
    throw new Error("Cannot update invalid YAML configuration", {
      cause: doc.errors[0],
    });
  }

  // If document is empty or has no content, create a new config.
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

  const config = doc.toJS() as any;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Configuration must be a YAML mapping");
  }

  if ("models" in config && config.models !== undefined) {
    if (!Array.isArray(config.models)) {
      throw new Error("Cannot update configuration: models must be an array");
    }
    if (
      config.models.some(
        (existingModel: unknown) =>
          !existingModel ||
          typeof existingModel !== "object" ||
          Array.isArray(existingModel),
      )
    ) {
      throw new Error(
        "Cannot update configuration: every model must be a mapping",
      );
    }
  } else {
    config.models = [];
  }

  // Replace managed explicit models in place so custom fields survive. Legacy
  // slug blocks are removed because they cannot be resolved by the CLI.
  const replacedModels = new Set<string>();
  config.models = config.models.flatMap((existingModel: any) => {
    if (!isManagedAnthropicModel(existingModel)) {
      return [existingModel];
    }

    const replacement = newModels.find(
      (newModel) =>
        existingModel.provider === newModel.provider &&
        existingModel.model === newModel.model,
    );
    if (!replacement) {
      return [];
    }

    replacedModels.add(replacement.model);
    const preservedCustomFields = { ...existingModel };
    for (const field of ["apiKey", "apiBase", "env"]) {
      delete preservedCustomFields[field];
    }

    return [
      {
        ...preservedCustomFields,
        ...replacement,
        ...(existingModel.defaultCompletionOptions
          ? {
              defaultCompletionOptions: {
                ...existingModel.defaultCompletionOptions,
                ...replacement.defaultCompletionOptions,
              },
            }
          : {}),
      },
    ];
  });

  config.models.push(
    ...newModels.filter((newModel) => !replacedModels.has(newModel.model)),
  );

  // Update the models array while preserving top-level comments and structure.
  doc.set("models", config.models);

  return doc.toString();
}
