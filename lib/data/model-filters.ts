import { ModelQuota } from "./types";
import {
  OBSERVED_MODEL_IDS,
  OBSERVED_MODEL_PROVIDER_OVERRIDES,
} from "./observed-models";

const OBSERVED_MODEL_SET = new Set<string>(OBSERVED_MODEL_IDS);

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase();
}

export function getObservedProvider(modelId: string): string | null {
  const normalized = normalizeModelId(modelId);
  if (!OBSERVED_MODEL_SET.has(normalized)) {
    return null;
  }
  return OBSERVED_MODEL_PROVIDER_OVERRIDES[normalized] || "Qwen";
}

export function isObservedModel(modelId: string): boolean {
  return OBSERVED_MODEL_SET.has(normalizeModelId(modelId));
}

export function filterObservedModels(models: ModelQuota[]): ModelQuota[] {
  return models.filter((model) => isObservedModel(model.id || model.modelName));
}

export function normalizeObservedModelId(modelId: string): string {
  return normalizeModelId(modelId);
}
