import * as path from "node:path";

import { updateModelName } from "../../auth/workos.js";
import { env } from "../../env.js";
import {
  createOrUpdateProviderConfig,
  type ProviderSetup,
} from "../../onboarding.js";
import {
  SERVICE_NAMES,
  serviceContainer,
  services,
} from "../../services/index.js";
import { useNavigation } from "../context/NavigationContext.js";

interface UseProviderConnectionProps {
  onMessage: (message: {
    role: string;
    content: string;
    messageType: "system";
  }) => void;
  handleClear: () => void;
  onClose?: () => void;
}

const CONFIG_PATH = path.join(env.continueHome, "config.yaml");

/**
 * Persist a provider connection, reload the dependent services, and return the
 * user to chat with the newly configured model available immediately.
 */
export function useProviderConnection({
  onMessage,
  handleClear,
  onClose,
}: UseProviderConnectionProps) {
  const { closeCurrentScreen } = useNavigation();

  const handleProviderConnect = async (setup: ProviderSetup): Promise<void> => {
    await createOrUpdateProviderConfig(setup);

    // Config reload also refreshes MODEL and MCP services. This makes the
    // connected provider usable without restarting the CLI.
    await services.config.updateConfigPath(CONFIG_PATH);

    // Config reload honors the previously persisted model. Make this explicit
    // connection the active model and persist the choice for the next startup.
    const modelIndex = services.model.getModelIndexByName(
      setup.model,
      setup.provider.provider,
    );
    if (modelIndex < 0) {
      throw new Error(`Connected model ${setup.model} was not found`);
    }

    await services.model.switchModel(modelIndex);
    const modelState = services.model.getState();
    serviceContainer.set(SERVICE_NAMES.MODEL, modelState);

    const modelInfo = services.model.getModelInfo();
    if (modelInfo?.name) {
      const updatedAuthConfig = updateModelName(modelInfo.name);
      const currentAuthState = services.auth.getState();
      serviceContainer.set(SERVICE_NAMES.AUTH, {
        ...currentAuthState,
        authConfig: updatedAuthConfig,
      });
    }

    (onClose ?? closeCurrentScreen)();
    handleClear();
    onMessage({
      role: "system",
      content: `Connected ${setup.provider.label} with model ${setup.model}.`,
      messageType: "system",
    });
  };

  return { handleProviderConnect };
}
