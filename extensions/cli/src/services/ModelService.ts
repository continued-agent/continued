import { AssistantUnrolled, ModelConfig } from "@continuedev/config-yaml";
import {
  fetchRemoteModels as fetchModels,
  type FetchedModel,
} from "core/llm/fetchRemoteModels.js";

import { AuthConfig, getModelName } from "../auth/workos.js";
import { createLlmApi, getLlmApi } from "../config.js";
import { logger } from "../util/logger.js";

import { BaseService, ServiceWithDependencies } from "./BaseService.js";
import { AgentFileServiceState, ModelServiceState } from "./types.js";

export interface RefreshChatModelsResult {
  errors: string[];
  fetched: boolean;
}

/**
 * Service for managing LLM and model state
 * Depends on auth config and assistant config
 */
export class ModelService
  extends BaseService<ModelServiceState>
  implements ServiceWithDependencies
{
  private availableModels: ModelConfig[] = [];
  private assistant: AssistantUnrolled | null = null;
  private authConfig: AuthConfig | null = null;

  constructor() {
    super("ModelService", {
      llmApi: null,
      model: null,
      assistant: null,
      authConfig: null,
    });
  }

  /**
   * Declare dependencies on other services
   */
  getDependencies(): string[] {
    return ["auth", "config", "agentFile"];
  }

  private getChatModels(assistant: AssistantUnrolled | null): ModelConfig[] {
    return (assistant?.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];
  }

  /**
   * Initialize the model service
   */
  async doInitialize(
    assistant: AssistantUnrolled,
    authConfig: AuthConfig,
    agentFileServiceState: AgentFileServiceState | undefined,
  ): Promise<ModelServiceState> {
    logger.debug("ModelService.doInitialize called", {
      hasAssistant: !!assistant,
      hasAuthConfig: !!authConfig,
      assistantModelsCount: assistant?.models?.length || 0,
    });

    this.assistant = assistant;
    this.authConfig = authConfig;
    this.availableModels = this.getChatModels(assistant);

    let preferredModelName: string | null | undefined = null;
    let modelSource = "default";

    // Priority = agentFile -> last selected model
    if (agentFileServiceState?.agentFileModel?.name) {
      preferredModelName = agentFileServiceState.agentFileModel?.name;
      modelSource = "agentFile";
    } else {
      const persistedName = getModelName(authConfig);
      if (persistedName) {
        preferredModelName = persistedName;
        modelSource = "persisted";
      }
    }

    // Try to use the preferred model (agent file or persisted)
    if (preferredModelName) {
      // During initialization, we need to check against availableModels directly
      const modelIndex = this.availableModels.findIndex((model) => {
        const name = (model as any).name || (model as any).model;
        return name === preferredModelName;
      });
      if (modelIndex === -1) {
        // Preferred model not found, use default model selection
        const [llmApi, model] = getLlmApi(assistant, authConfig);
        return {
          llmApi,
          model,
          assistant,
          authConfig,
        };
      } else {
        // Use the preferred model - but we need to handle initialization specially
        // During init, currentState isn't set yet, so switchModel would fail
        // Instead, we'll manually switch here
        const selectedModel = this.availableModels[modelIndex];
        logger.debug(`Using ${modelSource} model during initialization`, {
          modelIndex,
          provider: selectedModel.provider,
          name: (selectedModel as any).name || "unnamed",
          modelSource,
        });

        const llmApi = createLlmApi(selectedModel, authConfig);
        if (!llmApi) {
          throw new Error(`Failed to initialize LLM with ${modelSource} model`);
        }

        return {
          llmApi,
          model: selectedModel,
          assistant,
          authConfig,
        };
      }
    } else {
      // Use default model selection
      const [llmApi, model] = getLlmApi(assistant, authConfig);
      return {
        llmApi,
        model,
        assistant,
        authConfig,
      };
    }
  }

  /**
   * Override isReady to check for required state
   */
  override isReady(): boolean {
    return (
      super.isReady() &&
      this.currentState.llmApi !== null &&
      this.currentState.model !== null
    );
  }

  /**
   * Get model information for display
   */
  getModelInfo(): { provider: string; name: string } | null {
    if (!this.currentState.model) {
      return null;
    }

    return {
      provider: this.currentState.model.provider,
      name:
        (this.currentState.model as any).name ||
        (this.currentState.model as any).model ||
        "unnamed",
    };
  }

  /**
   * Get list of available chat models
   */
  getAvailableChatModels(): Array<{
    provider: string;
    name: string;
    index: number;
  }> {
    // Get assistant from state to ensure we have the latest data
    const { assistant } = this.getState();
    const chatModels =
      this.availableModels.length > 0
        ? this.availableModels
        : this.getChatModels(assistant);
    if (chatModels.length === 0) {
      return [];
    }

    return chatModels.map((model, index) => ({
      provider: model.provider,
      name: (model as any).name || (model as any).model || "unnamed",
      index,
    }));
  }

  /**
   * Fetch the current model catalogue for each configured chat provider.
   * Configured models remain available when a provider cannot be queried.
   */
  async refreshAvailableChatModels(): Promise<RefreshChatModelsResult> {
    const assistant = this.getState().assistant || this.assistant;
    const configuredModels = this.getChatModels(assistant);
    const errors: string[] = [];
    const fetchedModels: ModelConfig[] = [];
    const providers = new Map<
      string,
      { base: ModelConfig; models: ModelConfig[] }
    >();

    for (const model of configuredModels) {
      const key = `${model.provider}\u0000${model.apiBase ?? ""}\u0000${model.apiKey ?? ""}`;
      const provider = providers.get(key);
      if (provider) {
        provider.models.push(model);
      } else {
        providers.set(key, { base: model, models: [model] });
      }
    }

    let fetched = false;
    await Promise.all(
      [...providers.values()].map(
        async ({ base, models: configuredProviderModels }) => {
          try {
            const models = await fetchModels(
              base.provider,
              base.apiKey,
              base.apiBase,
            );

            if (models.length === 0) {
              throw new Error("the provider returned no chat models");
            }

            fetched = true;
            fetchedModels.push(
              ...models.map((fetchedModel) =>
                this.createFetchedModelConfig(base, fetchedModel),
              ),
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            errors.push(`${base.provider}: ${message}`);
            fetchedModels.push(...configuredProviderModels);
          }
        },
      ),
    );

    fetchedModels.sort((left, right) => {
      const providerOrder = left.provider.localeCompare(right.provider);
      return providerOrder || left.model.localeCompare(right.model);
    });
    errors.sort();
    this.availableModels = fetchedModels;

    return {
      errors,
      fetched,
    };
  }

  private createFetchedModelConfig(
    configuredModel: ModelConfig,
    fetchedModel: FetchedModel,
  ): ModelConfig {
    const modelId = fetchedModel.modelId || fetchedModel.name;
    return {
      ...configuredModel,
      name: modelId,
      model: modelId,
    };
  }

  /**
   * Switch to a different chat model by index
   */
  async switchModel(modelIndex: number): Promise<ModelServiceState> {
    // Get assistant and authConfig from state, but fall back to instance properties
    // This is needed during initialization when state isn't set yet
    const stateValues = this.getState();
    const assistant = stateValues.assistant || this.assistant;
    const authConfig = stateValues.authConfig || this.authConfig;

    // Debug logging to understand the state
    logger.debug("switchModel: Checking state", {
      hasStateAssistant: !!stateValues.assistant,
      hasStateAuthConfig: !!stateValues.authConfig,
      hasInstanceAssistant: !!this.assistant,
      hasInstanceAuthConfig: !!this.authConfig,
      isInitialized: this.isReady(),
      isReady: this.isReady(),
      modelIndex,
    });

    if (!assistant) {
      logger.error("switchModel: Missing assistant data", {
        assistant: !!assistant,
        authConfig: !!authConfig,
        stateKeys: Object.keys(stateValues),
        currentState: {
          hasLlmApi: !!stateValues.llmApi,
          hasModel: !!stateValues.model,
          hasAssistant: !!stateValues.assistant,
          hasAuthConfig: !!stateValues.authConfig,
        },
      });
      throw new Error("ModelService not initialized - assistant data missing");
    }

    const availableModels =
      this.availableModels.length > 0
        ? this.availableModels
        : this.getChatModels(assistant);

    if (modelIndex < 0 || modelIndex >= availableModels.length) {
      throw new Error(
        `Invalid model index: ${modelIndex}. Available models: 0-${availableModels.length - 1}`,
      );
    }

    const selectedModel = availableModels[modelIndex];
    logger.debug("Switching to model", {
      modelIndex,
      provider: selectedModel.provider,
      name: (selectedModel as any).name || "unnamed",
    });

    try {
      const llmApi = createLlmApi(selectedModel, authConfig);

      if (!llmApi) {
        throw new Error("Failed to initialize LLM with selected model");
      }

      this.setState({
        llmApi,
        model: selectedModel,
        assistant,
        authConfig,
      });

      logger.debug("Model switched successfully", {
        modelProvider: selectedModel.provider,
        modelName: (selectedModel as any).name || "unnamed",
      });

      return this.getState();
    } catch (error: any) {
      logger.error("Failed to switch model:", error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Get current model index
   */
  getCurrentModelIndex(): number {
    const state = this.getState();
    if (!state.model || !state.assistant) {
      return -1;
    }

    // Get available models from state
    const availableModels =
      this.availableModels.length > 0
        ? this.availableModels
        : this.getChatModels(state.assistant);

    if (availableModels.length === 0) {
      return -1;
    }

    return availableModels.findIndex(
      (model) =>
        model.provider === state.model?.provider &&
        (model.model === state.model?.model ||
          (model.name || model.model) === (state.model as ModelConfig).name),
    );
  }

  /**
   * Get model index by name and provider
   */
  getModelIndexByName(modelName: string, provider?: string): number {
    const state = this.getState();
    if (!state.assistant) {
      return -1;
    }

    // Get available models from state
    const availableModels =
      this.availableModels.length > 0
        ? this.availableModels
        : this.getChatModels(state.assistant);

    return availableModels.findIndex((model) => {
      const names = [model.name, model.model];
      const nameMatches = names.includes(modelName);

      if (provider) {
        return nameMatches && model.provider === provider;
      }

      return nameMatches;
    });
  }

  static getSubagentModels(modelState: ModelServiceState) {
    if (!modelState.assistant) {
      return [];
    }
    const subagentModels = modelState.assistant.models
      ?.filter((model) => !!model)
      .filter((model) => !!model.name) // filter out models without a name
      .filter((model) => model.roles?.includes("subagent")) // filter with role subagent
      .filter((model) => !!model.chatOptions?.baseSystemMessage); // filter those with a system message

    if (!subagentModels) {
      return [];
    }
    return subagentModels?.map((model) => ({
      llmApi: createLlmApi(model, modelState.authConfig),
      model,
      assistant: modelState.assistant,
      authConfig: modelState.authConfig,
    }));
  }
}
