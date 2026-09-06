import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { ONBOARDING_PROVIDERS } from "../onboardingProviders.js";

import { ProviderConnectionForm } from "./ProviderConnectionForm.js";

describe("ProviderConnectionForm", () => {
  it("collects a provider API key without rendering the secret", async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    const provider = ONBOARDING_PROVIDERS.find(
      (candidate) => candidate.id === "openai",
    )!;
    const { stdin, lastFrame, unmount } = render(
      <ProviderConnectionForm
        provider={provider}
        onConnect={onConnect}
        onCancel={vi.fn()}
      />,
    );

    stdin.write("sk-test-secret");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lastFrame()).not.toContain("sk-test-secret");

    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider,
        model: provider.model,
        apiKey: "sk-test-secret",
      }),
    );
    unmount();
  });

  it("requires credentials before submitting", async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    const provider = ONBOARDING_PROVIDERS.find(
      (candidate) => candidate.id === "anthropic",
    )!;
    const { stdin, lastFrame, unmount } = render(
      <ProviderConnectionForm
        provider={provider}
        onConnect={onConnect}
        onCancel={vi.fn()}
      />,
    );

    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onConnect).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("is required");
    unmount();
  });

  it("collects custom endpoint and model values", async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    const provider = ONBOARDING_PROVIDERS.find(
      (candidate) => candidate.id === "custom",
    )!;
    const { stdin, lastFrame, unmount } = render(
      <ProviderConnectionForm
        provider={provider}
        onConnect={onConnect}
        onCancel={vi.fn()}
      />,
    );

    stdin.write("key");
    await vi.waitFor(() => expect(lastFrame()).toContain("•••"));
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("● API base URL:"));
    stdin.write("https://localhost/v1");
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("https://localhost/v1"),
    );
    stdin.write("\r");
    await vi.waitFor(() => expect(lastFrame()).toContain("● Model name:"));
    stdin.write("my-model");
    await vi.waitFor(() => expect(lastFrame()).toContain("my-model"));
    stdin.write("\r");
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledOnce());

    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "key",
        apiBase: "https://localhost/v1",
        model: "my-model",
      }),
    );
    expect(lastFrame()).toContain("•••");
    expect(lastFrame()).not.toContain(":key");
    unmount();
  });
});
