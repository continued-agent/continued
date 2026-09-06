import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";

import type { ProviderSetup } from "../onboarding.js";
import type { OnboardingProvider } from "../onboardingProviders.js";

type ConnectionFieldKey =
  | "apiKey"
  | "apiBase"
  | "model"
  | "apiVersion"
  | "region"
  | "profile";

interface ConnectionField {
  key: ConnectionFieldKey;
  label: string;
  value: string;
  required: boolean;
  secret?: boolean;
  edited?: boolean;
}

interface ProviderConnectionFormProps {
  provider: OnboardingProvider;
  onConnect: (setup: ProviderSetup) => Promise<void>;
  onCancel: () => void;
}

function createInitialFields(provider: OnboardingProvider): ConnectionField[] {
  const fields: ConnectionField[] = [];

  if (provider.apiKeyEnv) {
    fields.push({
      key: "apiKey",
      label: provider.apiKeyOptional
        ? `API key (optional, ${provider.apiKeyEnv})`
        : `API key (${provider.apiKeyEnv})`,
      value: "",
      required: !provider.apiKeyOptional,
      secret: true,
    });
  }

  if (provider.requiresCustomApiBase || provider.requiresAzureSettings) {
    fields.push({
      key: "apiBase",
      label: provider.requiresAzureSettings
        ? "Azure OpenAI endpoint"
        : "API base URL",
      value: provider.apiBase ?? "",
      required: true,
    });
  }

  if (provider.requiresCustomModel || provider.requiresAzureSettings) {
    fields.push({
      key: "model",
      label: provider.requiresAzureSettings ? "Deployment name" : "Model name",
      value: provider.model,
      required: true,
    });
  }

  if (provider.requiresAzureSettings) {
    fields.push({
      key: "apiVersion",
      label: "Azure API version",
      value: "2024-10-21",
      required: true,
    });
  }

  if (provider.requiresBedrockSettings) {
    fields.push({
      key: "region",
      label: "AWS region",
      value: "us-east-1",
      required: true,
    });
    fields.push({
      key: "profile",
      label: "AWS profile (optional)",
      value: "",
      required: false,
    });
  }

  return fields;
}

function buildProviderSetup(
  provider: OnboardingProvider,
  fields: ConnectionField[],
): ProviderSetup {
  const values = new Map(
    fields.map((field) => [field.key, field.value.trim()]),
  );
  const model = values.get("model") || provider.model;
  const apiBase = values.get("apiBase") || provider.apiBase;
  const apiKey = values.get("apiKey") || undefined;

  let env: Record<string, string> | undefined;
  if (provider.requiresAzureSettings) {
    env = {
      apiType: "azure-openai",
      deployment: model,
      apiVersion: values.get("apiVersion") || "2024-10-21",
    };
  } else if (provider.requiresBedrockSettings) {
    env = {
      region: values.get("region") || "us-east-1",
    };
    const profile = values.get("profile");
    if (profile) {
      env.profile = profile;
    }
  }

  return {
    provider,
    model,
    apiKey,
    apiBase,
    env,
    // A manual connection is an explicit request to use this provider now.
    prepend: true,
  };
}

export function ProviderConnectionForm({
  provider,
  onConnect,
  onCancel,
}: ProviderConnectionFormProps) {
  const initialFields = useMemo(
    () => createInitialFields(provider),
    [provider],
  );
  const [fields, setFields] = useState(initialFields);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    const missing = fields.find(
      (field) => field.required && !field.value.trim(),
    );
    if (missing) {
      setFocusedIndex(fields.indexOf(missing));
      setError(`${missing.label} is required.`);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await onConnect(buildProviderSetup(provider, fields));
    } catch (connectionError) {
      setError(
        connectionError instanceof Error
          ? connectionError.message
          : "Failed to connect provider.",
      );
      setIsSubmitting(false);
    }
  };

  useInput((input, key) => {
    if (isSubmitting) {
      return;
    }

    if (key.escape || (key.ctrl && input === "c")) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setFocusedIndex((current) =>
        current === 0 ? fields.length - 1 : current - 1,
      );
      setError(null);
      return;
    }

    if (key.downArrow || key.tab) {
      setFocusedIndex((current) => (current + 1) % fields.length);
      setError(null);
      return;
    }

    if (key.return) {
      if (focusedIndex < fields.length - 1) {
        setFocusedIndex((current) => current + 1);
        setError(null);
      } else {
        void submit();
      }
      return;
    }

    if (key.backspace || key.delete) {
      setFields((current) =>
        current.map((field, index) =>
          index === focusedIndex
            ? {
                ...field,
                value: field.edited ? field.value.slice(0, -1) : "",
                edited: true,
              }
            : field,
        ),
      );
      setError(null);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setFields((current) =>
        current.map((field, index) =>
          index === focusedIndex
            ? {
                ...field,
                value: field.edited ? field.value + input : input,
                edited: true,
              }
            : field,
        ),
      );
      setError(null);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} width="100%" minWidth={0}>
      <Text bold color="blue" wrap="truncate-end">
        Connect {provider.label}
      </Text>
      <Text color="gray" wrap="truncate-end">
        Enter the connection details. Secrets are stored in ~/.continue/.env.
      </Text>
      <Text> </Text>

      {fields.map((field, index) => {
        const isFocused = index === focusedIndex;
        const renderedValue = field.secret
          ? field.value.replace(/./g, "•")
          : field.value;

        return (
          <Box key={field.key} width="100%" minWidth={0}>
            <Text color={isFocused ? "blue" : "gray"} bold={isFocused}>
              {isFocused ? "● " : "  "}
            </Text>
            <Text color={isFocused ? "white" : "gray"} wrap="truncate-end">
              {field.label}:
            </Text>
            <Text color={renderedValue ? "white" : "gray"} wrap="truncate-end">
              {renderedValue || "(press Enter to keep the default)"}
              {isFocused && "▌"}
            </Text>
          </Box>
        );
      })}

      {error && (
        <Text color="red" wrap="truncate-end">
          {error}
        </Text>
      )}
      <Text> </Text>
      <Text color="gray" wrap="truncate-end">
        ↑/↓ or Tab to move, Enter to continue, Esc to cancel
      </Text>
    </Box>
  );
}
