import React, { useEffect, useState } from "react";

import {
  SERVICE_NAMES,
  serviceContainer,
  services,
} from "../services/index.js";

import { Selector, SelectorOption } from "./Selector.js";

interface ModelOption extends SelectorOption {
  index: number;
  provider: string;
}

interface ModelSelectorProps {
  onSelect: (model: ModelOption) => void;
  onCancel: () => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  onSelect,
  onCancel,
}) => {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentModelIndex, setCurrentModelIndex] = useState<number>(-1);

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      try {
        // The selector can be opened while the dependency graph is still
        // settling. Wait for the model service instead of permanently
        // displaying an empty list.
        if (!services.model.isReady()) {
          await serviceContainer.get(SERVICE_NAMES.MODEL);
        }

        if (cancelled) {
          return;
        }

        const availableModels = services.model.getAvailableChatModels();
        const currentIndex = services.model.getCurrentModelIndex();

        if (availableModels.length === 0) {
          setError("No chat models available in the configuration");
          setLoading(false);
          return;
        }

        const modelOptions: ModelOption[] = availableModels.map((model) => ({
          id: `${model.provider}-${model.name}-${model.index}`,
          name: `${model.provider}/${model.name}`,
          index: model.index,
          provider: model.provider,
        }));

        const selectedIndex =
          currentIndex >= 0 && currentIndex < modelOptions.length
            ? currentIndex
            : 0;
        setModels(modelOptions);
        setCurrentModelIndex(currentIndex);
        setSelectedIndex(selectedIndex);
        setLoading(false);
      } catch (err: any) {
        if (cancelled) {
          return;
        }
        setError(err.message || "Failed to load models");
        setLoading(false);
      }
    };

    void loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Selector
      title="Select Model"
      options={models}
      selectedIndex={selectedIndex}
      loading={loading}
      error={error}
      loadingMessage="Loading available models..."
      currentId={
        models.find((model) => model.index === currentModelIndex)?.id ?? null
      }
      onSelect={onSelect}
      onCancel={onCancel}
      onNavigate={setSelectedIndex}
    />
  );
};

export { ModelSelector };
