import * as fs from "fs";
import * as path from "path";

import chalk from "chalk";
import { setConfigFilePermissions } from "core/util/paths.js";

import type { AuthConfig } from "./auth/workos.js";
import { getApiClient } from "./config.js";
import { hasValidConfigFile, loadConfiguration } from "./configLoader.js";
import { env } from "./env.js";
import {
  ONBOARDING_PROVIDERS,
  OnboardingProvider,
} from "./onboardingProviders.js";
import { selectOnboardingProvider } from "./ui/ProviderSelector.js";
import { question, secretQuestion } from "./util/prompt.js";
import {
  ProviderModelConfig,
  updateProviderModelInYaml,
} from "./util/yamlConfigUpdater.js";

const CONFIG_PATH = path.join(env.continueHome, "config.yaml");
const ENV_PATH = path.join(env.continueHome, ".env");

export interface ProviderSetup {
  provider: OnboardingProvider;
  model: string;
  apiKey?: string;
  apiBase?: string;
  env?: Record<string, string>;
}

const MODEL_ROLES = ["chat", "edit", "apply"];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Persist a secret in Continue's user-level .env file without exposing it in
 * config.yaml or in terminal output.
 */
export function writeSecretToEnvFile(
  secretName: string,
  secretValue: string,
  envPath: string = ENV_PATH,
): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(secretName)) {
    throw new Error(`Invalid environment variable name: ${secretName}`);
  }

  const envDir = path.dirname(envPath);
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
  }

  const assignment = `${secretName}=${JSON.stringify(secretValue)}`;
  const existingContent = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8")
    : "";
  const lines = existingContent.split(/\r?\n/);
  const assignmentPattern = new RegExp(
    `^\\s*(?:export\\s+)?${escapeRegExp(secretName)}\\s*=`,
  );
  let replaced = false;

  const updatedLines = lines.map((line) => {
    if (!line.trimStart().startsWith("#") && assignmentPattern.test(line)) {
      replaced = true;
      return assignment;
    }
    return line;
  });

  if (!replaced) {
    if (updatedLines.length === 1 && updatedLines[0] === "") {
      updatedLines[0] = assignment;
    } else {
      updatedLines.push(assignment);
    }
  }

  let updatedContent = updatedLines.join("\n");
  if (!updatedContent.endsWith("\n")) {
    updatedContent += "\n";
  }

  fs.writeFileSync(envPath, updatedContent, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}

async function promptWithDefault(
  promptText: string,
  defaultValue: string,
): Promise<string> {
  const answer = await question(
    `${promptText}${defaultValue ? ` [${defaultValue}]` : ""}: `,
  );
  return answer.trim() || defaultValue;
}

async function promptRequired(
  promptText: string,
  defaultValue?: string,
): Promise<string> {
  while (true) {
    const answer = await promptWithDefault(promptText, defaultValue ?? "");
    if (answer) {
      return answer;
    }
    console.log(chalk.yellow("A value is required."));
  }
}

async function collectProviderSetup(
  provider: OnboardingProvider,
): Promise<ProviderSetup> {
  let model = provider.model;
  let apiBase = provider.apiBase;
  let providerEnv: Record<string, string> | undefined;

  let apiKey: string | undefined;
  if (provider.apiKeyEnv) {
    const optionalMessage = provider.apiKeyOptional
      ? " (leave blank to use your AWS credentials)"
      : "";
    const enteredApiKey = await secretQuestion(
      `Enter your ${provider.label} API key${optionalMessage}: `,
    );
    if (!enteredApiKey && !provider.apiKeyOptional) {
      throw new Error(`${provider.label} API key cannot be empty.`);
    }
    apiKey = enteredApiKey || undefined;
  }

  if (provider.requiresCustomApiBase) {
    apiBase = await promptRequired("API base URL", apiBase);
  }

  if (provider.requiresCustomModel) {
    model = await promptRequired("Model name", model);
  }

  if (provider.requiresAzureSettings) {
    apiBase = await promptRequired(
      "Azure OpenAI endpoint (for example https://resource.openai.azure.com)",
    );
    const deployment = await promptRequired("Azure deployment name", model);
    const apiVersion = await promptRequired("Azure API version", "2024-10-21");
    model = deployment;
    providerEnv = {
      apiType: "azure-openai",
      deployment,
      apiVersion,
    };
  }

  if (provider.requiresBedrockSettings) {
    const region = await promptWithDefault("AWS region", "us-east-1");
    const profile = await promptWithDefault("AWS profile (optional)", "");
    providerEnv = { region };
    if (profile) {
      providerEnv.profile = profile;
    }
  }

  return { provider, model, apiKey, apiBase, env: providerEnv };
}

export async function createOrUpdateProviderConfig(
  setup: ProviderSetup,
): Promise<void> {
  const configDir = path.dirname(CONFIG_PATH);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (setup.apiKey && setup.provider.apiKeyEnv) {
    writeSecretToEnvFile(setup.provider.apiKeyEnv, setup.apiKey);
  }

  const modelConfig: ProviderModelConfig = {
    name: setup.provider.label,
    provider: setup.provider.provider,
    model: setup.model,
    roles: MODEL_ROLES,
    ...(setup.apiKey && setup.provider.apiKeyEnv
      ? {
          apiKey: "${{ secrets." + setup.provider.apiKeyEnv + " }}",
        }
      : {}),
    ...(setup.apiBase ? { apiBase: setup.apiBase } : {}),
    ...(setup.env ? { env: setup.env } : {}),
  };

  const existingContent = fs.existsSync(CONFIG_PATH)
    ? fs.readFileSync(CONFIG_PATH, "utf8")
    : "";
  const updatedContent = updateProviderModelInYaml(
    existingContent,
    modelConfig,
  );
  fs.writeFileSync(CONFIG_PATH, updatedContent);
  setConfigFilePermissions(CONFIG_PATH);
}

export async function checkHasAcceptableModel(
  configPath: string,
): Promise<boolean> {
  return hasValidConfigFile(configPath);
}

export async function createOrUpdateConfig(apiKey: string): Promise<void> {
  const anthropicProvider = ONBOARDING_PROVIDERS.find(
    (provider) => provider.provider === "anthropic",
  );

  if (!anthropicProvider) {
    throw new Error("Anthropic onboarding provider is not configured.");
  }

  await createOrUpdateProviderConfig({
    provider: anthropicProvider,
    model: anthropicProvider.model,
    apiKey,
  });
}

export async function runOnboardingFlow(
  configPath: string | undefined,
): Promise<boolean> {
  // Step 1: Check if --config flag is provided
  if (configPath !== undefined) {
    return false;
  }

  // A valid local config is authoritative, even when the marker file is
  // missing (for example after an upgrade or a restored home directory).
  if (hasValidConfigFile(CONFIG_PATH)) {
    return true;
  }

  // Step 2: Check for CONTINUE_USE_BEDROCK environment variable first (before test env check)
  if (process.env.CONTINUE_USE_BEDROCK === "1") {
    console.log(
      chalk.blue("✓ Using AWS Bedrock (CONTINUE_USE_BEDROCK detected)"),
    );
    return true;
  }

  // Step 3: Check if we're in a test/CI environment - if so, skip interactive prompts
  const isTestEnv =
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true" ||
    process.env.VITEST === "true" ||
    process.env.GITHUB_ACTIONS === "true" ||
    !process.stdin.isTTY;

  if (isTestEnv) {
    // In test/CI environment, check for ANTHROPIC_API_KEY first
    if (process.env.ANTHROPIC_API_KEY) {
      console.log(chalk.blue("✓ Using ANTHROPIC_API_KEY from environment"));
      await createOrUpdateConfig(process.env.ANTHROPIC_API_KEY);
      console.log(chalk.gray(`  Config saved to: ${CONFIG_PATH}`));
      return true;
    }

    // Otherwise return a minimal working configuration
    return false;
  }

  // Step 4: Select a provider and collect its credentials/configuration.
  console.log(chalk.yellow("To get started, choose a model provider."));
  const provider = await selectOnboardingProvider();
  if (!provider) {
    return false;
  }

  const setup = await collectProviderSetup(provider);
  await createOrUpdateProviderConfig(setup);
  console.log(
    chalk.green(`✓ Config file updated successfully at ${CONFIG_PATH}`),
  );

  return true;
}

export async function isFirstTime(): Promise<boolean> {
  return !fs.existsSync(path.join(env.continueHome, ".onboarding_complete"));
}

export async function markOnboardingComplete(): Promise<void> {
  const flagPath = path.join(env.continueHome, ".onboarding_complete");
  const flagDir = path.dirname(flagPath);

  if (!fs.existsSync(flagDir)) {
    fs.mkdirSync(flagDir, { recursive: true });
  }

  fs.writeFileSync(flagPath, new Date().toISOString());
}

export async function initializeWithOnboarding(
  authConfig: AuthConfig,
  configPath: string | undefined,
) {
  const firstTime = await isFirstTime();

  if (configPath !== undefined) {
    // throw an early error is configPath is invalid or has errors
    try {
      await loadConfiguration(
        authConfig,
        configPath,
        getApiClient(undefined),
        [],
        false,
      );
    } catch (errorMessage) {
      throw new Error(
        `Failed to load config from "${configPath}": ${errorMessage}`,
      );
    }
  }

  if (!firstTime) return;

  const wasOnboarded = await runOnboardingFlow(configPath);
  if (wasOnboarded) {
    await markOnboardingComplete();
  }
}
