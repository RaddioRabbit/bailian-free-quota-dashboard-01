/**
 * 触发文件契约：Docker 容器与宿主机 watcher 通过共享卷上的
 * data/.fetch-trigger.json 交换抓取请求与结果。
 *
 * 状态机：
 *   (无文件) → pending → running → done / error
 *
 * 容器 API 写 pending，watcher 读取后改 running，抓取完成写 done/error。
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelQuota } from "./types";

export const TRIGGER_FILE_NAME = ".fetch-trigger.json";

export type FetchTriggerStatus = "pending" | "running" | "done" | "error";

export interface FetchTriggerResult {
  count: number;
  elapsedMs: number;
  updatedAt: string;
  // 把 models 直接带回触发文件，避免容器侧再读 quotas.json 被其他进程覆盖导致旧数据
  models?: ModelQuota[];
}

export interface FetchTriggerState {
  requestId: string;
  status: FetchTriggerStatus;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: FetchTriggerResult;
  error?: string;
  code?: string;
  // 用户上次是登出态时再次发起登录：watcher 必须丢掉宿主机旧 session，强制弹浏览器重新认证
  forceFreshLogin?: boolean;
  // 触发来源：login = 用户主动点登录，session 缺失/过期允许弹浏览器；
  //         fetch = 刷新数据，session 不可用直接报错（不打扰用户）；
  // 缺省视作 login，保持旧客户端的行为不被破坏。
  intent?: "fetch" | "login";
}

/** 10 分钟无进展视为僵尸 running */
export const STALE_THRESHOLD_MS = 10 * 60 * 1000;

export function getDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function getTriggerFilePath(): string {
  return path.join(getDataDir(), TRIGGER_FILE_NAME);
}

export function readTriggerState(): FetchTriggerState | null {
  const filePath = getTriggerFilePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as FetchTriggerState;
  } catch {
    return null;
  }
}

export function writeTriggerState(state: FetchTriggerState): void {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  // 原子写：先写临时文件再 rename，避免 reader 读到截断后未写入的中间状态
  const finalPath = getTriggerFilePath();
  const tmpPath = `${finalPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmpPath, finalPath);
}

export function generateRequestId(): string {
  return randomUUID();
}

export function isTriggerStale(state: FetchTriggerState): boolean {
  if (state.status !== "pending" && state.status !== "running") return false;
  const ts = state.startedAt || state.requestedAt;
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > STALE_THRESHOLD_MS;
}
