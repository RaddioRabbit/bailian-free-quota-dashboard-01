/**
 * Server-side data fetcher for the dashboard.
 * This module provides the main interface for fetching dashboard data,
 * supporting both real API calls and fallback to mock data.
 */

import { DashboardData, ModelQuota } from "./types";
import { fetchQuotaFromConsole, BailianScraperError } from "./bailian-scraper";
import { consoleScraper } from "./console-scraper";
import { filterObservedModels } from "./model-filters";
import { getSourceUrlsPreview, loadSourceConfig } from "./source-config";

// 缓存配置
interface CacheConfig {
  ttl: number; // 缓存有效期（毫秒）
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 5 * 60 * 1000, // 默认5分钟缓存
};

// 简单的内存缓存
interface CacheEntry {
  data: ModelQuota[];
  timestamp: number;
  apiKey: string;
}

let cache: CacheEntry | null = null;
const inFlightRequests = new Map<string, Promise<DashboardData>>();
const backgroundConsoleRefreshes = new Map<string, Promise<void>>();

/**
 * 检查缓存是否有效
 */
function isCacheValid(apiKey: string, ttl: number): boolean {
  if (!cache) return false;
  if (cache.apiKey !== apiKey) return false;
  const now = Date.now();
  return now - cache.timestamp < ttl;
}

/**
 * 获取缓存数据
 */
function getCachedData(): ModelQuota[] | null {
  return cache ? cache.data : null;
}

/**
 * 设置缓存数据
 */
function setCachedData(data: ModelQuota[], apiKey: string): void {
  cache = {
    data,
    timestamp: Date.now(),
    apiKey,
  };
}

/**
 * 清除缓存
 */
export function clearCache(): void {
  cache = null;
}

function getStaleCacheData(apiKey: string): ModelQuota[] | null {
  if (!cache || cache.apiKey !== apiKey) return null;
  return cache.data;
}

function buildSourceMetadata(sourceUrls: string[]) {
  return {
    sourceUrlCount: sourceUrls.length,
    sourceUrlsPreview: getSourceUrlsPreview(sourceUrls),
  };
}

function startBackgroundConsoleRefresh(cacheKey: string, sourceUrls: string[]): void {
  if (!sourceUrls.length || backgroundConsoleRefreshes.has(cacheKey)) {
    return;
  }

  const refreshPromise = (async () => {
    try {
      console.log("检测到已登录 session，正在后台抓取真实额度数据…");
      const models = await consoleScraper.scrapeQuotas(sourceUrls);
      setCachedData(models, cacheKey);
    } catch (e) {
      console.warn("后台控制台抓取失败，保留当前占位数据:", e);
    } finally {
      backgroundConsoleRefreshes.delete(cacheKey);
    }
  })();

  backgroundConsoleRefreshes.set(cacheKey, refreshPromise);
}

async function runWithRequestDeduplication(
  key: string,
  task: () => Promise<DashboardData>
): Promise<DashboardData> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing;
  }

  const promise = task().finally(() => {
    if (inFlightRequests.get(key) === promise) {
      inFlightRequests.delete(key);
    }
  });

  inFlightRequests.set(key, promise);
  return promise;
}

/**
 * 获取Dashboard数据的主入口函数
 * @param apiKey 阿里云百炼API Key（可选，无API Key时返回模拟数据）
 * @param options 可选配置
 * @returns Dashboard数据
 */
export async function getDashboardData(
  apiKey?: string,
  options?: {
    useCache?: boolean;
    cacheConfig?: Partial<CacheConfig>;
    useMockOnFailure?: boolean;
  }
): Promise<DashboardData> {
  const {
    useCache = true,
    cacheConfig = {},
    useMockOnFailure = true,
  } = options || {};

  const config = { ...DEFAULT_CACHE_CONFIG, ...cacheConfig };

  // 检查环境变量中的API Key
  const effectiveApiKey = apiKey || process.env.DASHSCOPE_API_KEY;
  const sourceConfig = loadSourceConfig();
  const sourceUrls = sourceConfig.sourceUrls;
  const sourceMetadata = buildSourceMetadata(sourceUrls);
  const hasConsoleSession = consoleScraper.sessionExists();
  const requestKey = hasConsoleSession
    ? `__console_session__:${sourceUrls.join("|") || "__no_sources__"}`
    : (effectiveApiKey || "__mock__");

  return runWithRequestDeduplication(requestKey, async () => {
    // 优先：如果有已登录的控制台 session，使用 Playwright 抓取真实数据
    if (hasConsoleSession) {
      const cacheKey = requestKey;
      if (!sourceUrls.length) {
        return {
          models: [],
          updatedAt: new Date().toISOString(),
          _note: "no_sources",
          fetchStatusText: "请先配置抓取页面",
          ...sourceMetadata,
        };
      }

      if (useCache && isCacheValid(cacheKey, config.ttl)) {
        const cached = getCachedData();
        if (cached) {
          return {
            models: cached,
            updatedAt: new Date(cache!.timestamp).toISOString(),
            ...sourceMetadata,
          };
        }
      }

      startBackgroundConsoleRefresh(cacheKey, sourceUrls);

      const staleConsoleData = getStaleCacheData(cacheKey);
      if (staleConsoleData) {
        return {
          models: staleConsoleData,
          updatedAt: new Date(cache!.timestamp).toISOString(),
          ...sourceMetadata,
        };
      }

      // 已登录但尚未抓取到数据，返回空列表并标记正在加载
      return {
        models: [],
        updatedAt: new Date().toISOString(),
        _note: "fetching",
        fetchStatusText: "正在拉取数据",
        ...sourceMetadata,
      };
    }

    // 如果没有API Key且没有 session，返回空数据
    if (!effectiveApiKey) {
      return {
        models: [],
        updatedAt: new Date().toISOString(),
        ...sourceMetadata,
      };
    }

    // 检查缓存
    if (useCache && isCacheValid(effectiveApiKey, config.ttl)) {
      const cachedData = getCachedData();
      if (cachedData) {
        return {
          models: cachedData,
          updatedAt: new Date(cache!.timestamp).toISOString(),
          ...sourceMetadata,
        };
      }
    }

    try {
      // 从阿里云控制台获取数据
      const models = await fetchQuotaFromConsole(effectiveApiKey, {
        useMockOnFailure,
      });
      const observedModels = filterObservedModels(models);

      // 更新缓存
      if (useCache) {
        setCachedData(observedModels, effectiveApiKey);
      }

      return {
        models: observedModels,
        updatedAt: new Date().toISOString(),
        ...sourceMetadata,
      };
    } catch (error) {
      // 如果出错且有缓存，返回缓存数据（即使已过期）
      if (useCache && cache) {
        console.warn("获取新数据失败，使用缓存数据");
        return {
          models: cache.data,
          updatedAt: new Date(cache.timestamp).toISOString(),
          ...sourceMetadata,
        };
      }

      // 重新抛出错误
      throw error;
    }
  });
}

/**
 * 直接获取模型配额数据（简化接口）
 * @param apiKey 阿里云百炼API Key
 * @returns 模型配额列表
 */
export async function fetchModelQuotas(apiKey?: string): Promise<ModelQuota[]> {
  const data = await getDashboardData(apiKey);
  return data.models;
}

/**
 * 获取API Key验证状态
 * @param apiKey 阿里云百炼API Key
 * @returns 验证结果
 */
export async function verifyApiKey(apiKey?: string): Promise<{
  valid: boolean;
  message: string;
}> {
  const effectiveApiKey = apiKey || process.env.DASHSCOPE_API_KEY;

  if (!effectiveApiKey) {
    return {
      valid: false,
      message: "未提供API Key",
    };
  }

  try {
    // 尝试获取数据来验证API Key
    await fetchQuotaFromConsole(effectiveApiKey, { useMockOnFailure: false });
    return {
      valid: true,
      message: "API Key有效",
    };
  } catch (error) {
    if (error instanceof BailianScraperError) {
      return {
        valid: false,
        message: error.message,
      };
    }

    return {
      valid: false,
      message: `验证失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
