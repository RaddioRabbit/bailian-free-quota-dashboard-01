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
const LOGOUT_MARKER_FILENAME = ".logged-out";

function getDataDir(): string {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

function getQuotaFilePath(): string {
  return path.join(getDataDir(), QUOTA_FILENAME);
}

function getLogoutMarkerPath(): string {
  return path.join(getDataDir(), LOGOUT_MARKER_FILENAME);
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

/**
 * 登出标记：用于双模式 logout。
 * 容器侧调用 markLoggedOut 后，auth GET / dashboard data 看到 marker 即视为未登录，
 * 直到下一次成功抓取或显式登录把 marker 清掉。
 *
 * 不删除 quotas.json，避免误操作丢数据；marker 写在共享数据目录，
 * Docker 模式下宿主机 watcher 也能读到/清除。
 */
export function isLoggedOutMarked(): boolean {
  return fs.existsSync(getLogoutMarkerPath());
}

export function markLoggedOut(): void {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getLogoutMarkerPath(), new Date().toISOString(), "utf8");
}

export function clearLoggedOutMarker(): void {
  const p = getLogoutMarkerPath();
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}
