/**
 * File-based data loader for Docker containerization.
 *
 * Reads model quota data from a shared directory mounted via Docker volume.
 * Playwright scraper (running on the host) writes to ./data/quotas.json,
 * and the container reads from /app/data/quotas.json via DATA_DIR env var.
 */

import fs from "node:fs";
import path from "node:path";
import { ModelQuota, DashboardData } from "./types";

const DEFAULT_DATA_DIR = "./data";
const QUOTA_FILENAME = "quotas.json";

function getDataDir(): string {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

function getQuotaFilePath(): string {
  return path.join(getDataDir(), QUOTA_FILENAME);
}

function buildEmptyData(): DashboardData {
  return {
    models: [],
    updatedAt: new Date().toISOString(),
    _note: "no_sources",
    fetchStatusText: "暂无数据，请在宿主机运行 Playwright 抓取",
  };
}

/**
 * Load model quota data from the shared data directory.
 * Returns empty data with a helpful message if the file does not exist or is invalid.
 */
export function loadQuotaDataFromFile(): DashboardData {
  const filePath = getQuotaFilePath();

  if (!fs.existsSync(filePath)) {
    console.log(`[file-loader] Quota file not found at ${filePath}`);
    return buildEmptyData();
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object") {
      console.warn("[file-loader] Quota file is not a valid JSON object");
      return buildEmptyData();
    }

    const record = parsed as Record<string, unknown>;

    // Support both { models: [...] } and direct array [...]
    let models: ModelQuota[] = [];
    if (Array.isArray(record.models)) {
      models = record.models as ModelQuota[];
    } else if (Array.isArray(parsed)) {
      models = parsed as ModelQuota[];
    }

    const updatedAt =
      typeof record.updatedAt === "string"
        ? record.updatedAt
        : new Date().toISOString();

    return {
      models,
      updatedAt,
    };
  } catch (error) {
    console.warn(
      "[file-loader] Failed to parse quota file:",
      error instanceof Error ? error.message : String(error)
    );
    return buildEmptyData();
  }
}

/**
 * Check whether a quota data file exists in the shared data directory.
 */
export function quotaFileExists(): boolean {
  return fs.existsSync(getQuotaFilePath());
}
