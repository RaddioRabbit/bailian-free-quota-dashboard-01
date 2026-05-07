import { ModelQuota } from "./types";
import {
  OBSERVED_MODEL_IDS,
  OBSERVED_MODEL_PROVIDER_OVERRIDES,
} from "./observed-models";

const PROVIDER_ALIASES: Record<string, string[]> = {
  "mini-max": ["mini-max", "minimax", "minimax/"],
  minimax: ["mini-max", "minimax", "minimax/"],
  qwen: ["qwen"],
  "moonshot-ai": ["moonshot-ai", "moonshot", "kimi"],
  moonshot: ["moonshot-ai", "moonshot", "kimi"],
  kimi: ["moonshot-ai", "moonshot", "kimi"],
  deepseek: ["deepseek"],
  "zhipu-ai": ["zhipu-ai", "zhipu", "glm"],
  zhipu: ["zhipu-ai", "zhipu", "glm"],
  glm: ["zhipu-ai", "zhipu", "glm"],
  happyhorse: ["happyhorse"],
};

const OBSERVED_MODEL_SET = new Set<string>(OBSERVED_MODEL_IDS);

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeProviderCode(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function compactProviderCode(value: string): string {
  return normalizeProviderCode(value).replace(/[-_]/g, "");
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

export function parseProviderCodesFromSourceUrl(sourceUrl: string): string[] {
  try {
    const url = new URL(sourceUrl);
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const hashQuery = hash.includes("?") ? hash.split("?")[1] : "";
    const params = new URLSearchParams(hashQuery);
    const rawProviders = params.get("providers");
    if (!rawProviders) return [];
    return rawProviders
      .split(",")
      .map((provider) => normalizeProviderCode(provider))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function modelMatchesProvider(model: ModelQuota, providerCode: string): boolean {
  const aliases = PROVIDER_ALIASES[providerCode] || [providerCode];
  const haystack = [
    model.id,
    model.modelName,
    model.provider,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeProviderCode(value));

  return aliases.some((alias) => {
    const normalizedAlias = normalizeProviderCode(alias);
    const compactAlias = compactProviderCode(alias);
    return haystack.some((value) => {
      if (value === normalizedAlias || value.startsWith(`${normalizedAlias}/`)) {
        return true;
      }
      if (compactProviderCode(value) === compactAlias) {
        return true;
      }
      return value.includes(normalizedAlias);
    });
  });
}

export function filterModelsBySourceUrls(
  models: ModelQuota[],
  sourceUrls: string[]
): ModelQuota[] {
  const providerCodes = Array.from(
    new Set(sourceUrls.flatMap((sourceUrl) => parseProviderCodesFromSourceUrl(sourceUrl)))
  );

  if (providerCodes.length === 0) {
    return models;
  }

  return models.filter((model) =>
    providerCodes.some((providerCode) => modelMatchesProvider(model, providerCode))
  );
}

/**
 * 过滤掉已过期的模型：expiresAt 早于当前时间的视为已过期，从展示列表剔除。
 * 不修改源数据（quotas.json 仍保留完整记录），只影响 API 返回。
 *
 * 容错：expiresAt 字段缺失或日期解析失败时，保留该模型而不是误删。
 */
export function filterOutExpiredModels(models: ModelQuota[]): ModelQuota[] {
  const now = Date.now();
  return models.filter((model) => {
    if (!model.expiresAt) return true;
    const expiry = new Date(model.expiresAt).getTime();
    if (Number.isNaN(expiry)) return true;
    return expiry >= now;
  });
}
