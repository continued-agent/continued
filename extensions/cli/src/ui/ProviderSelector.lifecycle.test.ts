import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRender } = vi.hoisted(() => ({ mockRender: vi.fn() }));

vi.mock("ink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ink")>()),
  render: mockRender,
}));

import type { OnboardingProvider } from "../onboardingProviders.js";

import { selectOnboardingProvider } from "./ProviderSelector.js";

const provider: OnboardingProvider = {
  id: "test-provider",
  label: "Test provider",
  provider: "openai",
  model: "test-model",
  description: "Test provider",
};

describe("selectOnboardingProvider", () => {
  beforeEach(() => {
    mockRender.mockReset();
  });

  it("defers resolution until after Ink has unmounted the picker", async () => {
    let onSelect: ((selected: OnboardingProvider) => void) | undefined;
    const unmount = vi.fn();

    mockRender.mockImplementation((element: ReactElement) => {
      onSelect = (element.props as { onSelect: typeof onSelect }).onSelect;
      return { unmount };
    });

    const selection = selectOnboardingProvider([provider]);
    onSelect?.(provider);

    await Promise.resolve();
    expect(unmount).toHaveBeenCalledOnce();

    let settled = false;
    void selection.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await new Promise(setImmediate);
    await expect(selection).resolves.toBe(provider);
  });
});
