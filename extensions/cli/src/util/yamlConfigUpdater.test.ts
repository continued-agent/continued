import { parse } from "yaml";

import {
  updateAnthropicModelInYaml,
  updateProviderModelInYaml,
} from "./yamlConfigUpdater.js";

describe("updateAnthropicModelInYaml", () => {
  const testApiKey = "sk-ant-test123456789";

  describe("empty or invalid input", () => {
    it("should create new config from empty string", () => {
      const result = updateAnthropicModelInYaml("", testApiKey);

      expect(result).toContain("name: Main Config");
      expect(result).toContain("version: 1.0.0");
      expect(result).toContain("schema: v1");
      expect(result).toContain("provider: anthropic");
      expect(result).toContain("model: claude-sonnet-4-6");
      expect(result).toContain("apiKey: sk-ant-test123456789");
      expect(result).not.toContain("uses:");
    });

    it("should create new config from invalid YAML", () => {
      const invalidYaml = "invalid: [yaml content";
      const result = updateAnthropicModelInYaml(invalidYaml, testApiKey);

      expect(result).toContain("name: Main Config");
      expect(result).toContain("model: claude-sonnet-4-6");
      expect(result).toContain("apiKey: sk-ant-test123456789");
      expect(result).not.toContain("uses:");
    });
  });

  describe("comment preservation", () => {
    it("should preserve comments when adding new model", () => {
      const yamlWithComments = `# My Continue config
name: Main Config
version: 1.0.0
schema: v1
# List of available models
models:
  - name: GPT-4
    provider: openai
    model: gpt-4
    apiKey: TEST-openai-test
`;

      const result = updateAnthropicModelInYaml(yamlWithComments, testApiKey);

      expect(result).toContain("# My Continue config");
      expect(result).toContain("# List of available models");
      expect(result).toContain("model: gpt-4");
      expect(result).toContain("model: claude-sonnet-4-6");
      expect(result).toContain("apiKey: sk-ant-test123456789");
    });

    it("should preserve comments when updating existing model", () => {
      const yamlWithComments = `# My Continue config
name: Main Config
version: 1.0.0
schema: v1
# List of available models
models:
  - name: Claude Sonnet 4.6
    provider: anthropic
    model: claude-sonnet-4-6
    apiKey: old-key
`;

      const result = updateAnthropicModelInYaml(yamlWithComments, testApiKey);

      expect(result).toContain("# My Continue config");
      expect(result).toContain("# List of available models");
      expect(result).toContain("model: claude-sonnet-4-6");
      expect(result).toContain("apiKey: sk-ant-test123456789");
      expect(result).not.toContain("old-key");
    });

    it("should replace legacy slug-based anthropic blocks", () => {
      const yamlWithSlug = `name: Main Config
version: 1.0.0
schema: v1
models:
  - uses: anthropic/claude-sonnet-4-6
    with:
      ANTHROPIC_API_KEY: old-key
`;

      const result = updateAnthropicModelInYaml(yamlWithSlug, testApiKey);

      expect(result).not.toContain("uses:");
      expect(result).not.toContain("old-key");
      expect(result).toContain("provider: anthropic");
      expect(result).toContain("model: claude-sonnet-4-6");
      expect(result).toContain("apiKey: sk-ant-test123456789");
    });
  });

  describe("model management", () => {
    it("should add new anthropic model when none exists", () => {
      const existingConfig = `name: Main Config
version: 1.0.0
schema: v1
models:
  - name: GPT-4
    provider: openai
    model: gpt-4
    apiKey: TEST-openai-test
`;

      const result = updateAnthropicModelInYaml(existingConfig, testApiKey);

      expect(result).toContain("model: gpt-4");
      expect(result).toContain("model: claude-sonnet-4-6");
      expect(result).toContain("apiKey: sk-ant-test123456789");
      expect(result).toContain("apiKey: TEST-openai-test");
    });

    it("should update existing anthropic model", () => {
      const existingConfig = `name: Main Config
version: 1.0.0
schema: v1
models:
  - name: Claude Sonnet 4.6
    provider: anthropic
    model: claude-sonnet-4-6
    apiKey: old-anthropic-key
  - name: GPT-4
    provider: openai
    model: gpt-4
    apiKey: TEST-openai-test
`;

      const result = updateAnthropicModelInYaml(existingConfig, testApiKey);

      expect(result).toContain("model: claude-sonnet-4-6");
      expect(result).toContain("model: gpt-4");
      expect(result).toContain("apiKey: sk-ant-test123456789");
      expect(result).toContain("apiKey: TEST-openai-test");
      expect(result).not.toContain("old-anthropic-key");

      // Should only have one Claude Sonnet model
      const sonnetMatches = result.match(/model: claude-sonnet-4-6/g);
      expect(sonnetMatches).toHaveLength(1);
    });

    it("should handle config with no models array", () => {
      const configWithoutModels = `name: Main Config
version: 1.0.0
schema: v1
`;

      const result = updateAnthropicModelInYaml(
        configWithoutModels,
        testApiKey,
      );

      expect(result).toContain("name: Main Config");
      expect(result).toContain("models:");
      expect(result).toContain("model: claude-sonnet-4-6");
      expect(result).toContain("apiKey: sk-ant-test123456789");
    });

    it("should handle config with empty models array", () => {
      const configWithEmptyModels = `name: Main Config
version: 1.0.0
schema: v1
models: []
`;

      const result = updateAnthropicModelInYaml(
        configWithEmptyModels,
        testApiKey,
      );

      expect(result).toContain("name: Main Config");
      expect(result).toContain("model: claude-sonnet-4-6");
      expect(result).toContain("apiKey: sk-ant-test123456789");
    });
  });

  describe("structure validation", () => {
    it("should produce valid YAML that can be parsed", () => {
      const input = `# Test config
name: Test
models:
  - name: Existing
    provider: openai
    model: existing-model
    apiKey: test
`;

      const result = updateAnthropicModelInYaml(input, testApiKey);

      // Should not throw when parsing
      expect(() => {
        parse(result);
      }).not.toThrow();
    });

    it("should maintain proper YAML structure", () => {
      const result = updateAnthropicModelInYaml("", testApiKey);

      expect(result).toMatch(/^name: /m);
      expect(result).toMatch(/^version: /m);
      expect(result).toMatch(/^schema: /m);
      expect(result).toMatch(/^models:/m);
      expect(result).toMatch(/^\s+- name: /m);
      expect(result).toMatch(/^\s+provider: anthropic/m);
      expect(result).toMatch(/^\s+apiKey: /m);
    });
  });

  describe("edge cases", () => {
    it("should handle malformed models array gracefully", () => {
      const malformedConfig = `name: Main Config
models: "not an array"
`;

      const result = updateAnthropicModelInYaml(malformedConfig, testApiKey);

      expect(result).toContain("model: claude-sonnet-4-6");
      expect(result).toContain("apiKey: sk-ant-test123456789");
    });

    it("should handle different API key formats", () => {
      const differentKeys = [
        "sk-ant-1234567890",
        "sk-ant-abcdefghijklmnop",
        "sk-ant-test-key-with-dashes",
      ];

      differentKeys.forEach((key) => {
        const result = updateAnthropicModelInYaml("", key);
        expect(result).toContain(`apiKey: ${key}`);
      });
    });
  });
});

describe("updateProviderModelInYaml", () => {
  const providerModel = {
    name: "OpenAI",
    provider: "openai",
    model: "gpt-4.1-mini",
    apiKey: "${{ secrets.OPENAI_API_KEY }}",
    roles: ["chat", "edit", "apply"],
  };

  it("creates a valid config with a secret reference", () => {
    const result = updateProviderModelInYaml("", providerModel);
    const parsed = parse(result) as any;

    expect(parsed.name).toBe("Main Config");
    expect(parsed.schema).toBe("v1");
    expect(parsed.models).toEqual([providerModel]);
    expect(result).not.toContain("sk-");
  });

  it("preserves existing models and replaces the selected model", () => {
    const existingConfig = `name: Existing\nversion: 1.0.0\nschema: v1\nmodels:\n  - name: Other\n    provider: anthropic\n    model: claude-sonnet-4-6\n    roles:\n      - chat\n`;

    const result = updateProviderModelInYaml(existingConfig, providerModel);
    const parsed = parse(result) as any;

    expect(parsed.models).toHaveLength(2);
    expect(parsed.models[0].provider).toBe("anthropic");
    expect(parsed.models[1]).toEqual(providerModel);

    const updated = updateProviderModelInYaml(result, {
      ...providerModel,
      apiKey: "${{ secrets.NEW_OPENAI_API_KEY }}",
    });
    const updatedParsed = parse(updated) as any;
    expect(updatedParsed.models).toHaveLength(2);
    expect(updatedParsed.models[1].apiKey).toBe(
      "${{ secrets.NEW_OPENAI_API_KEY }}",
    );
  });
});
