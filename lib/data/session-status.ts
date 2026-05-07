/**
 * 宿主机 fetch-watcher 与容器 /api/auth 之间的 session 状态共享文件。
 *
 * 背景：容器内看不见宿主机的 .session.json，过去 /api/auth 用 quotas.json + 是否登出标记
 *      推断登录态，结果是"前端已登录、watcher 报 SESSION_EXPIRED"的脱钩。
 *
 * 契约：
 *   - watcher 是唯一写入方：启动时探测、抓取/登录/登出后回写
 *   - 容器 /api/auth GET 是主要读取方：作为登录态判定的优先依据
 *   - 文件不存在 = 还没有 watcher 报告过状态，调用方按"未知"兜底
 *
 * 故意不放在 process.cwd()：watcher 与容器需要共享 data/ 卷。
 */
import fs from "node:fs";
import path from "node:path";

export const SESSION_STATUS_FILE_NAME = ".session-status.json";

export type SessionInvalidReason =
  | "missing" // .session.json 文件不存在
  | "expired" // 已确认 session 过期（用户手动登出/抓取多次失败）
  | "cleared"; // 用户主动 logout 或 forceFreshLogin 清掉

export interface SessionStatus {
  valid: boolean;
  lastValidatedAt: string;
  lastInvalidReason?: SessionInvalidReason;
}

function getDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function getSessionStatusPath(): string {
  return path.join(getDataDir(), SESSION_STATUS_FILE_NAME);
}

export function readSessionStatus(): SessionStatus | null {
  const filePath = getSessionStatusPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as SessionStatus;
  } catch {
    return null;
  }
}

function writeSessionStatus(status: SessionStatus): void {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const finalPath = getSessionStatusPath();
  // 原子写：先临时文件再 rename，避免读到截断中间态
  const tmpPath = `${finalPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2), "utf8");
  fs.renameSync(tmpPath, finalPath);
}

export function markSessionValid(): void {
  writeSessionStatus({
    valid: true,
    lastValidatedAt: new Date().toISOString(),
  });
}

export function markSessionInvalid(reason: SessionInvalidReason): void {
  writeSessionStatus({
    valid: false,
    lastValidatedAt: new Date().toISOString(),
    lastInvalidReason: reason,
  });
}
