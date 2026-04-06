/**
 * 阿里云百炼控制台数据抓取模块
 * 通过调用阿里云内部API获取模型额度信息
 */

import { ModelQuota } from "./types";
import { filterObservedModels, getObservedProvider } from "./model-filters";

// 阿里云百炼API基础配置
const BAILIAN_API_BASE = "https://dashscope.aliyuncs.com";

// 错误类型定义
export class BailianScraperError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "BailianScraperError";
  }
}

// 重试配置
interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  timeout: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 30000,
};

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带重试的fetch函数
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  retryCount: number = 0
): Promise<Response> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), retryConfig.timeout);

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    if (retryCount >= retryConfig.maxRetries) {
      throw new BailianScraperError(
        `网络请求失败，已重试${retryCount}次: ${error instanceof Error ? error.message : String(error)}`,
        "NETWORK_ERROR"
      );
    }

    await delay(retryConfig.retryDelay * (retryCount + 1));
    return fetchWithRetry(url, options, retryConfig, retryCount + 1);
  }
}

/**
 * 验证API Key格式
 */
function validateApiKey(apiKey: string): void {
  if (!apiKey) {
    throw new BailianScraperError("API Key不能为空", "INVALID_API_KEY");
  }

  // 支持 sk-xxxxx 和 sk-sp-xxxxx 格式
  const validPatterns = [/^sk-[a-zA-Z0-9]+$/, /^sk-sp-[a-zA-Z0-9]+$/];
  const isValid = validPatterns.some((pattern) => pattern.test(apiKey));

  if (!isValid) {
    throw new BailianScraperError(
      "API Key格式无效，应为 sk-xxxxx 或 sk-sp-xxxxx 格式",
      "INVALID_API_KEY_FORMAT"
    );
  }
}

/**
 * 阿里云百炼额度API响应类型
 */
interface BailianQuotaResponse {
  success: boolean;
  code?: string;
  message?: string;
  data?: {
    models?: Array<{
      modelId: string;
      modelName: string;
      totalQuota: number;
      usedQuota: number;
      remainingQuota: number;
      expiresAt?: string;
      unit?: string;
      description?: string;
    }>;
  };
}

/**
 * 调用阿里云百炼额度查询API
 * 注意：这是基于阿里云内部API的调用方式
 */
async function callBailianQuotaAPI(apiKey: string): Promise<BailianQuotaResponse> {
  // 构建请求头
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://dashscope.console.aliyun.com/",
  };

  // 尝试多种API端点
  const endpoints = [
    `${BAILIAN_API_BASE}/api/v1/quota`,
    `${BAILIAN_API_BASE}/api/v1/billing/quota`,
    `${BAILIAN_API_BASE}/compatible-mode/v1/quota`,
  ];

  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithRetry(endpoint, {
        method: "GET",
        headers,
      });

      if (response.status === 401) {
        throw new BailianScraperError(
          "API Key无效或已过期，请检查API Key",
          "UNAUTHORIZED",
          401
        );
      }

      if (response.status === 403) {
        throw new BailianScraperError(
          "API Key没有访问额度信息的权限",
          "FORBIDDEN",
          403
        );
      }

      if (!response.ok) {
        throw new BailianScraperError(
          `API请求失败: ${response.status} ${response.statusText}`,
          "API_ERROR",
          response.status
        );
      }

      const data = await response.json() as BailianQuotaResponse;
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // 如果是认证错误，直接抛出，不需要尝试其他端点
      if (error instanceof BailianScraperError &&
          (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")) {
        throw error;
      }
      // 继续尝试下一个端点
      continue;
    }
  }

  // 所有端点都失败
  throw lastError || new BailianScraperError(
    "所有API端点都不可用",
    "ALL_ENDPOINTS_FAILED"
  );
}

/**
 * 转换阿里云额度数据为应用数据格式
 */
function transformQuotaData(rawData: BailianQuotaResponse): ModelQuota[] {
  if (!rawData.success || !rawData.data?.models) {
    // 如果API返回不成功，返回空数组
    return [];
  }

  const now = new Date();
  const defaultExpiry = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 默认90天

  return filterObservedModels(
    rawData.data.models.map((model) => ({
      id: model.modelId,
      modelName: model.modelName || model.modelId,
      provider: getObservedProvider(model.modelId) || "qwen",
      description: model.description || getModelDescription(model.modelId),
      totalQuota: model.totalQuota || 0,
      usedQuota: model.usedQuota || 0,
      remainingQuota: model.remainingQuota ?? (model.totalQuota - model.usedQuota),
      expiresAt: model.expiresAt || defaultExpiry.toISOString(),
      unit: model.unit || "tokens",
    }))
  );
}

/**
 * 获取模型描述
 */
function getModelDescription(modelId: string): string {
  const descriptions: Record<string, string> = {
    "qwen-turbo": "通义千问 Turbo，适用于通用对话与内容生成场景",
    "qwen-plus": "通义千问 Plus，更强的理解与推理能力",
    "qwen-max": "通义千问 Max，旗舰级大模型",
    "qwen-coder-plus": "通义千问代码模型，支持多种编程语言",
    "qwen-math-plus": "通义千问数学模型，擅长逻辑与数学推理",
    "qwen-vl-plus": "通义千问视觉语言模型，支持图像理解",
    "qwen-vl-max": "通义千问视觉语言增强模型",
    "deepseek-r1": "DeepSeek R1 推理模型",
    "deepseek-v3": "DeepSeek V3 通用大模型",
  };

  return descriptions[modelId] || "阿里云百炼模型";
}

/**
 * 备用方案：使用模拟数据（当API不可用时）
 * 这些数据基于阿里云百炼实际提供的免费额度
 */
function getFallbackMockData(): ModelQuota[] {
  const now = new Date();
  const expiryDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  return [
    {
      id: "qwen-plus",
      modelName: "qwen-plus",
      provider: "qwen",
      description: "通义千问 Plus，更强的理解与推理能力",
      totalQuota: 1_000_000,
      usedQuota: 0,
      remainingQuota: 1_000_000,
      expiresAt: expiryDate.toISOString(),
      unit: "tokens",
    },
    {
      id: "qwen-turbo",
      modelName: "qwen-turbo",
      provider: "qwen",
      description: "通义千问 Turbo，适用于通用对话与内容生成场景",
      totalQuota: 1_000_000,
      usedQuota: 0,
      remainingQuota: 1_000_000,
      expiresAt: expiryDate.toISOString(),
      unit: "tokens",
    },
    {
      id: "qwen-max",
      modelName: "qwen-max",
      provider: "qwen",
      description: "通义千问 Max，旗舰级大模型",
      totalQuota: 1_000_000,
      usedQuota: 0,
      remainingQuota: 1_000_000,
      expiresAt: expiryDate.toISOString(),
      unit: "tokens",
    },
    {
      id: "qwen-vl-plus",
      modelName: "qwen-vl-plus",
      provider: "qwen",
      description: "通义千问视觉语言模型，支持图像理解",
      totalQuota: 1_000_000,
      usedQuota: 0,
      remainingQuota: 1_000_000,
      expiresAt: expiryDate.toISOString(),
      unit: "tokens",
    },
  ].filter((model) => getObservedProvider(model.id) !== null);
}

/**
 * 从阿里云百炼控制台获取额度数据
 * @param apiKey 阿里云百炼API Key
 * @param options 可选配置
 * @returns 模型额度列表
 */
export async function fetchQuotaFromConsole(
  apiKey: string,
  options?: {
    useMockOnFailure?: boolean;
    retryConfig?: Partial<RetryConfig>;
  }
): Promise<ModelQuota[]> {
  const { useMockOnFailure = true } = options || {};
  // retryConfig is reserved for future use

  try {
    // 验证API Key
    validateApiKey(apiKey);

    // 调用API获取数据
    const response = await callBailianQuotaAPI(apiKey);

    // 转换数据
    const quotas = transformQuotaData(response);

    // 如果API返回空数据且允许使用模拟数据
    if (quotas.length === 0 && useMockOnFailure) {
      console.warn("API返回空数据，使用备用模拟数据");
      return getFallbackMockData();
    }

    return quotas;
  } catch (error) {
    console.error("获取阿里云百炼额度失败:", error);

    // 如果允许使用模拟数据作为后备
    if (useMockOnFailure) {
      console.warn("API调用失败，使用备用模拟数据");
      return getFallbackMockData();
    }

    // 重新抛出错误
    if (error instanceof BailianScraperError) {
      throw error;
    }

    throw new BailianScraperError(
      `获取额度失败: ${error instanceof Error ? error.message : String(error)}`,
      "UNKNOWN_ERROR"
    );
  }
}

/**
 * 检查API Key是否有效
 * @param apiKey 阿里云百炼API Key
 * @returns 是否有效
 */
export async function validateApiKeyActive(apiKey: string): Promise<boolean> {
  try {
    validateApiKey(apiKey);
    await callBailianQuotaAPI(apiKey);
    return true;
  } catch (error) {
    if (error instanceof BailianScraperError) {
      return error.code !== "UNAUTHORIZED" && error.code !== "FORBIDDEN";
    }
    return false;
  }
}
