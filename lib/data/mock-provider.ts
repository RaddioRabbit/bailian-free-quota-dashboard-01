import { ModelQuota } from "./types";
import { filterObservedModels, getObservedProvider } from "./model-filters";

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(date: Date): string {
  return date.toISOString();
}

const now = new Date();

const MOCK_MODELS: ModelQuota[] = [
  {
    id: "qwen-turbo",
    modelName: "qwen-turbo",
    provider: "qwen",
    description: "通义千问 Turbo，适用于通用对话与内容生成场景",
    totalQuota: 1_000_000,
    usedQuota: 120_000,
    remainingQuota: 880_000,
    expiresAt: formatDate(addDays(now, 30)),
    unit: "tokens",
  },
  {
    id: "qwen-plus",
    modelName: "qwen-plus",
    provider: "qwen",
    description: "通义千问 Plus，更强的理解与推理能力",
    totalQuota: 500_000,
    usedQuota: 480_000,
    remainingQuota: 20_000,
    expiresAt: formatDate(addDays(now, 5)),
    unit: "tokens",
  },
  {
    id: "qwen-max",
    modelName: "qwen-max",
    provider: "qwen",
    description: "通义千问 Max，旗舰级大模型",
    totalQuota: 200_000,
    usedQuota: 195_000,
    remainingQuota: 5_000,
    expiresAt: formatDate(addDays(now, 2)),
    unit: "tokens",
  },
  {
    id: "qwen-coder-plus",
    modelName: "qwen-coder-plus",
    provider: "qwen",
    description: "通义千问代码模型，支持多种编程语言",
    totalQuota: 300_000,
    usedQuota: 50_000,
    remainingQuota: 250_000,
    expiresAt: formatDate(addDays(now, 14)),
    unit: "tokens",
  },
  {
    id: "qwen-math-plus",
    modelName: "qwen-math-plus",
    provider: "qwen",
    description: "通义千问数学模型，擅长逻辑与数学推理",
    totalQuota: 150_000,
    usedQuota: 140_000,
    remainingQuota: 10_000,
    expiresAt: formatDate(addDays(now, 3)),
    unit: "tokens",
  },
  {
    id: "qwen-vl-max",
    modelName: "qwen-vl-max",
    provider: "qwen",
    description: "通义千问视觉语言模型，支持图像理解",
    totalQuota: 100_000,
    usedQuota: 100_000,
    remainingQuota: 0,
    expiresAt: formatDate(addDays(now, -1)),
    unit: "tokens",
  },
  {
    id: "kimi-k2.5",
    modelName: "kimi-k2.5",
    provider: "Moonshot AI",
    description: "Kimi K2.5，适用于 Agent、代码生成与多模态理解",
    totalQuota: 600_000,
    usedQuota: 120_000,
    remainingQuota: 480_000,
    expiresAt: formatDate(addDays(now, 21)),
    unit: "tokens",
  },
  {
    id: "moonshot-kimi-k2-instruct",
    modelName: "moonshot-kimi-k2-instruct",
    provider: "Moonshot AI",
    description: "Moonshot Kimi K2 Instruct，适用于快速直接回答场景",
    totalQuota: 400_000,
    usedQuota: 90_000,
    remainingQuota: 310_000,
    expiresAt: formatDate(addDays(now, 12)),
    unit: "tokens",
  },
];

/**
 * Simulated network delay for realism.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch all model quota data (mock).
 * This is a drop-in replacement point for a real API call.
 */
export async function fetchModelQuotas(): Promise<ModelQuota[]> {
  // Simulate network latency 200-600ms
  await delay(200 + Math.random() * 400);
  // Return deep clone to prevent accidental mutation
  const cloned = JSON.parse(JSON.stringify(MOCK_MODELS)) as ModelQuota[];
  return filterObservedModels(
    cloned.map((model) => ({
      ...model,
      provider: getObservedProvider(model.id) || model.provider,
    }))
  );
}
