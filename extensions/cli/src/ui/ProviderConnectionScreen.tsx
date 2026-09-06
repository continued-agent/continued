import React, { useState } from "react";

import type { ProviderSetup } from "../onboarding.js";
import {
  ONBOARDING_PROVIDERS,
  type OnboardingProvider,
} from "../onboardingProviders.js";

import { ProviderConnectionForm } from "./ProviderConnectionForm.js";
import { ProviderSelector } from "./ProviderSelector.js";

interface ProviderConnectionScreenProps {
  onConnect: (setup: ProviderSetup) => Promise<void>;
  onCancel: () => void;
}

export function ProviderConnectionScreen({
  onConnect,
  onCancel,
}: ProviderConnectionScreenProps) {
  const [provider, setProvider] = useState<OnboardingProvider | null>(null);

  if (!provider) {
    return (
      <ProviderSelector
        options={ONBOARDING_PROVIDERS}
        onSelect={setProvider}
        onCancel={onCancel}
      />
    );
  }

  return (
    <ProviderConnectionForm
      provider={provider}
      onConnect={onConnect}
      onCancel={() => setProvider(null)}
    />
  );
}
