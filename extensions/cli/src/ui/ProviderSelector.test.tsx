import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { OnboardingProvider } from "../onboardingProviders.js";

import { ProviderSelector } from "./ProviderSelector.js";

function createProvider(index: number): OnboardingProvider {
  return {
    id: `provider-${index}`,
    label: `Provider ${index}`,
    provider: "openai",
    model: `model-${index}`,
    description: "Test provider",
  };
}

describe("ProviderSelector", () => {
  it("scrolls a long provider list as the selection moves", async () => {
    const providers = Array.from({ length: 20 }, (_, index) =>
      createProvider(index + 1),
    );
    const { lastFrame, stdin, unmount } = render(
      <ProviderSelector
        options={providers}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain("Provider 1");
    expect(lastFrame()).not.toContain("Provider 20");

    for (let index = 1; index < providers.length; index++) {
      stdin.write("j");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(lastFrame()).toContain("Provider 20");
    expect(lastFrame()).toContain("more providers above");
    unmount();
  });

  it("returns the selected provider on Enter", async () => {
    const providers = [createProvider(1), createProvider(2)];
    const onSelect = vi.fn();
    const { stdin, unmount } = render(
      <ProviderSelector
        options={providers}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );

    stdin.write("j");
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onSelect).toHaveBeenCalledWith(providers[1]);
    unmount();
  });

  it("renders a useful empty state without trapping the selector", () => {
    const { lastFrame, unmount } = render(
      <ProviderSelector options={[]} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(lastFrame()).toContain("No model providers are available");
    unmount();
  });
});
