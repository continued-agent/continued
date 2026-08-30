import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AuthConfig } from "./auth/workos.js";
import {
  checkHasAcceptableModel,
  createOrUpdateBedrockConfig,
  createTemporaryBedrockConfig,
  createOrUpdateProviderConfig,
  initializeWithOnboarding,
  writeSecretToEnvFile,
} from "./onboarding.js";
import { ONBOARDING_PROVIDERS } from "./onboardingProviders.js";

describe("onboarding config flag handling", () => {
  let tempDir: string;
  let mockAuthConfig: AuthConfig;

  beforeEach(() => {
    // Create a temporary directory for test config files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "continue-test-"));

    // Auth config is always null after Hub removal
    mockAuthConfig = null;
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("should fail loudly when --config points to non-existent file", async () => {
    const configPath = path.join(tempDir, "non-existent.yaml");

    // Verify the file doesn't exist
    expect(fs.existsSync(configPath)).toBe(false);

    // Should throw an error that mentions both the path and the failure
    await expect(
      initializeWithOnboarding(mockAuthConfig, configPath),
    ).rejects.toThrow(
      /Failed to load config from ".*non-existent\.yaml": .*ENOENT/,
    );
  });

  test("should fail loudly when --config points to malformed YAML file", async () => {
    const configPath = path.join(tempDir, "malformed.yaml");

    // Create a malformed YAML file
    fs.writeFileSync(
      configPath,
      `
name: "Test Config"
models:
  - name: "GPT-4"
    provider: "openai"
    invalid_yaml_syntax: [unclosed array
`,
    );

    // Verify the file exists
    expect(fs.existsSync(configPath)).toBe(true);

    // Should throw an error mentioning the path and failure to load
    await expect(
      initializeWithOnboarding(mockAuthConfig, configPath),
    ).rejects.toThrow(/Failed to load config from ".*malformed\.yaml": .+/);
  });

  test("should fail loudly when --config points to file with missing required fields", async () => {
    const configPath = path.join(tempDir, "incomplete.yaml");

    // Create a config file missing required fields
    fs.writeFileSync(
      configPath,
      `
name: "Incomplete Config"
# Missing models array and other required fields
`,
    );

    // Verify the file exists
    expect(fs.existsSync(configPath)).toBe(true);

    // Should throw with our specific error format and include path
    await expect(
      initializeWithOnboarding(mockAuthConfig, configPath),
    ).rejects.toThrow(/^Failed to load config from ".*": .+/);
  });

  test("should handle different config path formats with proper error messages", async () => {
    const testPaths = [
      "./non-existent.yaml",
      "/absolute/path/config.yaml",
      "../relative/config.yaml",
      "simple-name.yaml",
    ];

    for (const configPath of testPaths) {
      await expect(
        initializeWithOnboarding(mockAuthConfig, configPath),
      ).rejects.toThrow(/Failed to load config from ".*": .+/);
    }
  });

  test("should handle empty string config path", async () => {
    // Loads default agent with no error
    await initializeWithOnboarding(mockAuthConfig, "");
  });

  test("should not fall back to default config when explicit config fails", async () => {
    const configPath = path.join(tempDir, "bad-config.yaml");

    // Create a bad config file
    fs.writeFileSync(configPath, "invalid: yaml: content: [");

    const promise = initializeWithOnboarding(mockAuthConfig, configPath);

    await expect(promise).rejects.toThrow();

    try {
      await promise;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // CRITICAL: Must have our specific error format from the fix
      expect(message).toMatch(/^Failed to load config from ".*": .+/);

      // Error should be about the specific config file we provided
      expect(message).toContain(configPath);

      // Should NOT mention falling back to default config (this was the bug!)
      expect(message).not.toContain("~/.continue/config.yaml");
      expect(message).not.toContain("default config");
      expect(message).not.toContain("fallback");
    }
  });

  test("demonstrates the fix: explicit config failure vs no config provided", async () => {
    const badConfigPath = path.join(tempDir, "bad.yaml");
    fs.writeFileSync(badConfigPath, "invalid yaml [");

    // Case 1: Explicit --config that fails should throw our specific error
    await expect(
      initializeWithOnboarding(mockAuthConfig, badConfigPath),
    ).rejects.toThrow(/^Failed to load config from "/);

    // Case 2: No explicit config should follow different logic
    try {
      await initializeWithOnboarding(mockAuthConfig, undefined);
      // If it succeeds, that's fine - the point is it's different behavior
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      // This should NOT have our "Failed to load config from" prefix
      expect(errorMessage).not.toMatch(/^Failed to load config from "/);
    }
  });
});

describe("provider onboarding persistence", () => {
  const globalDir = process.env.CONTINUE_GLOBAL_DIR!;

  afterEach(() => {
    for (const filename of [
      "config.yaml",
      ".env",
      "secrets.env",
      ".onboarding_complete",
    ]) {
      const filePath = path.join(globalDir, filename);
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    }
  });

  test("writes API keys to .env and only references them from config.yaml", async () => {
    const envPath = path.join(globalDir, "secrets.env");
    writeSecretToEnvFile("OPENAI_API_KEY", "sk-test-value", envPath);

    expect(fs.readFileSync(envPath, "utf8")).toContain(
      'OPENAI_API_KEY="sk-test-value"',
    );

    await createOrUpdateProviderConfig({
      provider: ONBOARDING_PROVIDERS[0],
      model: ONBOARDING_PROVIDERS[0].model,
      apiKey: "sk-test-value",
    });

    const config = fs.readFileSync(path.join(globalDir, "config.yaml"), "utf8");
    expect(config).toContain("apiKey: ${{ secrets.OPENAI_API_KEY }}");
    expect(config).not.toContain("sk-test-value");
  });

  test("treats an existing valid config as already onboarded", async () => {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "config.yaml"),
      `name: Existing\nversion: 1.0.0\nschema: v1\nmodels:\n  - name: Existing\n    provider: openai\n    model: gpt-4.1-mini\n    roles:\n      - chat\n`,
    );

    await initializeWithOnboarding(null, undefined);

    expect(fs.existsSync(path.join(globalDir, ".onboarding_complete"))).toBe(
      true,
    );
  });

  test("requires an explicit chat-capable model for an acceptable config", async () => {
    const configPath = path.join(globalDir, "config.yaml");

    fs.writeFileSync(
      configPath,
      `name: Existing\nversion: 1.0.0\nschema: v1\nmodels:\n  - name: Embeddings\n    provider: openai\n    model: text-embedding-3-small\n    roles:\n      - embed\n`,
    );
    await expect(checkHasAcceptableModel(configPath)).resolves.toBe(false);

    fs.writeFileSync(
      configPath,
      `name: Existing\nversion: 1.0.0\nschema: v1\nmodels:\n  - name: Chat\n    provider: openai\n    model: gpt-4.1-mini\n    roles:\n      - chat\n`,
    );
    await expect(checkHasAcceptableModel(configPath)).resolves.toBe(true);

    fs.writeFileSync(
      configPath,
      `name: Existing\nversion: 1.0.0\nschema: v1\nmodels:\n  - name: Broken\n    provider: openai\n    model: gpt-4.1-mini\n    roles: chat\n`,
    );
    await expect(checkHasAcceptableModel(configPath)).resolves.toBe(false);
  });

  test("creates a Bedrock config with the shortcut helper", async () => {
    const originalRegion = process.env.AWS_REGION;
    const originalDefaultRegion = process.env.AWS_DEFAULT_REGION;
    const originalProfile = process.env.AWS_PROFILE;
    const originalApiKey = process.env.AWS_BEDROCK_API_KEY;
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_BEDROCK_API_KEY;

    try {
      await createOrUpdateBedrockConfig();

      const config = fs.readFileSync(
        path.join(globalDir, "config.yaml"),
        "utf8",
      );
      expect(config).toContain("provider: bedrock");
      expect(config).toContain(
        "model: anthropic.claude-sonnet-4-5-20250929-v1:0",
      );
      expect(config).toContain("region: us-east-1");
      expect(config).not.toContain("apiKey:");
    } finally {
      if (originalRegion === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = originalRegion;
      if (originalDefaultRegion === undefined)
        delete process.env.AWS_DEFAULT_REGION;
      else process.env.AWS_DEFAULT_REGION = originalDefaultRegion;
      if (originalProfile === undefined) delete process.env.AWS_PROFILE;
      else process.env.AWS_PROFILE = originalProfile;
      if (originalApiKey === undefined) delete process.env.AWS_BEDROCK_API_KEY;
      else process.env.AWS_BEDROCK_API_KEY = originalApiKey;
    }
  });

  test("uses AWS region and profile environment variables for Bedrock", async () => {
    const originalRegion = process.env.AWS_REGION;
    const originalDefaultRegion = process.env.AWS_DEFAULT_REGION;
    const originalProfile = process.env.AWS_PROFILE;
    process.env.AWS_REGION = "eu-west-1";
    delete process.env.AWS_DEFAULT_REGION;
    process.env.AWS_PROFILE = "engineering";

    try {
      await createOrUpdateBedrockConfig();
      const config = fs.readFileSync(
        path.join(globalDir, "config.yaml"),
        "utf8",
      );
      expect(config).toContain("region: eu-west-1");
      expect(config).toContain("profile: engineering");
    } finally {
      if (originalRegion === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = originalRegion;
      if (originalDefaultRegion === undefined)
        delete process.env.AWS_DEFAULT_REGION;
      else process.env.AWS_DEFAULT_REGION = originalDefaultRegion;
      if (originalProfile === undefined) delete process.env.AWS_PROFILE;
      else process.env.AWS_PROFILE = originalProfile;
    }
  });

  test("creates a one-shot Bedrock config without changing the saved config", () => {
    const savedConfigPath = path.join(globalDir, "config.yaml");
    fs.writeFileSync(
      savedConfigPath,
      `name: Existing\nversion: 1.0.0\nschema: v1\nmodels:\n  - name: Existing\n    provider: openai\n    model: gpt-4.1-mini\n`,
    );
    const savedConfig = fs.readFileSync(savedConfigPath, "utf8");

    const temporary = createTemporaryBedrockConfig();
    expect(fs.readFileSync(temporary.configPath, "utf8")).toContain(
      "provider: bedrock",
    );
    expect(fs.readFileSync(savedConfigPath, "utf8")).toBe(savedConfig);

    temporary.cleanup();
    expect(fs.existsSync(temporary.configPath)).toBe(false);
  });

  test("uses a one-shot Bedrock config during onboarding without marking completion", async () => {
    const originalBedrockSetting = process.env.CONTINUE_USE_BEDROCK;
    process.env.CONTINUE_USE_BEDROCK = "1";

    try {
      const temporaryConfigPath = await initializeWithOnboarding(
        null,
        undefined,
      );

      expect(temporaryConfigPath).toMatch(
        /continue-bedrock-[^/]+[\\/]config\.yaml$/,
      );
      expect(fs.existsSync(path.join(globalDir, "config.yaml"))).toBe(false);
      expect(fs.existsSync(path.join(globalDir, ".onboarding_complete"))).toBe(
        false,
      );

      if (temporaryConfigPath) {
        fs.rmSync(path.dirname(temporaryConfigPath), {
          recursive: true,
          force: true,
        });
      }
    } finally {
      if (originalBedrockSetting === undefined) {
        delete process.env.CONTINUE_USE_BEDROCK;
      } else {
        process.env.CONTINUE_USE_BEDROCK = originalBedrockSetting;
      }
    }
  });
});

// Separate describe block with its own mocking for BEDROCK tests
describe("CONTINUE_USE_BEDROCK environment variable", () => {
  const mockConsoleLog = vi.fn();
  let mockAuthConfig: AuthConfig;
  const originalEnv = process.env.CONTINUE_USE_BEDROCK;

  // Mock initialize for these tests only
  const mockInitialize = vi.fn().mockResolvedValue({
    config: { name: "test-config", models: [], rules: [] },
    llmApi: {},
    model: { name: "test-model" },
    mcpService: {},
    apiClient: {},
  });

  beforeEach(() => {
    mockConsoleLog.mockClear();
    mockInitialize.mockClear();

    // Spy on console.log for these tests
    vi.spyOn(console, "log").mockImplementation(mockConsoleLog);

    // Mock the config module
    vi.doMock("./config.js", () => ({ initialize: mockInitialize }));

    mockAuthConfig = null;
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.CONTINUE_USE_BEDROCK = originalEnv;
    } else {
      delete process.env.CONTINUE_USE_BEDROCK;
    }
    const globalDir = process.env.CONTINUE_GLOBAL_DIR;
    if (globalDir) {
      for (const filename of ["config.yaml", ".env", ".onboarding_complete"]) {
        const filePath = path.join(globalDir, filename);
        if (fs.existsSync(filePath)) {
          fs.rmSync(filePath, { force: true });
        }
      }
    }
    vi.restoreAllMocks();
    vi.doUnmock("./config.js");
  });

  test("should bypass interactive options when CONTINUE_USE_BEDROCK=1", async () => {
    process.env.CONTINUE_USE_BEDROCK = "1";

    // Re-import to get the mocked version
    vi.resetModules();
    const { runOnboardingFlow } = await import("./onboarding.js");

    const result = await runOnboardingFlow(undefined);

    expect(result).toBe(true);
    expect(
      fs.existsSync(path.join(process.env.CONTINUE_GLOBAL_DIR!, "config.yaml")),
    ).toBe(false);
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "✓ Using AWS Bedrock (CONTINUE_USE_BEDROCK detected)",
      ),
    );
  });

  test("should not bypass when CONTINUE_USE_BEDROCK is not '1'", async () => {
    process.env.CONTINUE_USE_BEDROCK = "0";

    // Re-import to get the mocked version
    vi.resetModules();
    const { runOnboardingFlow } = await import("./onboarding.js");

    // Mock non-interactive environment to avoid hanging
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;

    try {
      await runOnboardingFlow(undefined);

      // Verify the Bedrock message was NOT called by checking all calls
      const allCalls = mockConsoleLog.mock.calls.flat();
      const hasBedrockMessage = allCalls.some((call) =>
        String(call).includes(
          "✓ Using AWS Bedrock (CONTINUE_USE_BEDROCK detected)",
        ),
      );
      expect(hasBedrockMessage).toBe(false);
    } finally {
      process.stdin.isTTY = originalIsTTY;
    }
  });
});
