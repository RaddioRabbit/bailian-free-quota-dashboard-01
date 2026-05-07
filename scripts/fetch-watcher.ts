/**
 * fetch-watcher 守护进程
 *
 * 用途：Docker 模式下，容器无法运行 Playwright，但页面"刷新"按钮仍需触发抓取。
 *      容器把请求写入 data/.fetch-trigger.json，本进程在宿主机轮询并执行抓取。
 *
 * 使用：npm run fetch-watcher
 *
 * 流程：
 *   1. 轮询触发文件
 *   2. 发现 status=pending → 标记 running → 检查 session（缺则弹浏览器登录）
 *   3. 调用 consoleScraper.scrapeQuotas → 写 data/quotas.json
 *   4. 状态写回 done / error，容器侧 API 拉到结果
 */

import {
  consoleScraper,
  BailianConsoleSessionExpiredError,
} from "@/lib/data/console-scraper";
import { loadSourceConfig } from "@/lib/data/source-config";
import { filterModelsBySourceUrls } from "@/lib/data/model-filters";
import {
  readTriggerState,
  writeTriggerState,
  isTriggerStale,
  getTriggerFilePath,
  type FetchTriggerState,
  type FetchTriggerResult,
} from "@/lib/data/fetch-trigger";
import { clearLoggedOutMarker, markLoggedOut } from "@/lib/data/file-loader";
import {
  markSessionValid,
  markSessionInvalid,
} from "@/lib/data/session-status";
import fs from "node:fs";
import path from "node:path";

const POLL_INTERVAL_MS = 1500;
const IDLE_LOG_INTERVAL_MS = 30 * 1000;

interface ScrapeError extends Error {
  code?: string;
}

function makeError(message: string, code: string): ScrapeError {
  const err: ScrapeError = new Error(message);
  err.code = code;
  return err;
}

async function ensureSession(): Promise<void> {
  if (!consoleScraper.sessionExists()) {
    console.log("[fetch-watcher] 未找到 session，弹出浏览器登录...");
    console.log("[fetch-watcher] 请在弹出的浏览器中完成阿里云登录");
    await consoleScraper.login();
    markSessionValid();
    console.log("[fetch-watcher] 登录完成");
    return;
  }

  const valid = await consoleScraper.isSessionValid();
  if (!valid) {
    console.log("[fetch-watcher] Session 已过期，弹出浏览器重新登录...");
    await consoleScraper.login();
    markSessionValid();
  } else {
    markSessionValid();
  }
}

async function doScrape(): Promise<FetchTriggerResult> {
  const config = loadSourceConfig();
  if (config.sourceUrls.length === 0) {
    throw makeError(
      "请先在 /source-config 配置要抓取的模型广场页面",
      "NO_SOURCES"
    );
  }

  console.log(
    `[fetch-watcher] 开始抓取 ${config.sourceUrls.length} 个页面...`
  );
  const startedAt = Date.now();
  const scrapedQuotas = await consoleScraper.scrapeQuotas(config.sourceUrls);
  const quotas = filterModelsBySourceUrls(scrapedQuotas, config.sourceUrls);
  if (quotas.length !== scrapedQuotas.length) {
    console.log(
      `[fetch-watcher] 按配置页面过滤结果：${scrapedQuotas.length} -> ${quotas.length} 个模型`
    );
  }
  const elapsedMs = Date.now() - startedAt;

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dataPath = path.join(dataDir, "quotas.json");
  const updatedAt = new Date().toISOString();
  fs.writeFileSync(
    dataPath,
    JSON.stringify({ models: quotas, updatedAt }, null, 2),
    "utf8"
  );

  // 抓取成功 = 用户已重新认证（host watcher 持有有效 session），清掉 logout marker
  // 让容器侧 auth/data 恢复登录态
  clearLoggedOutMarker();
  markSessionValid();

  console.log(
    `[fetch-watcher] 抓取完成，${quotas.length} 个模型，耗时 ${(
      elapsedMs / 1000
    ).toFixed(1)}s`
  );
  console.log(
    `[fetch-watcher] 抓取完成！共 ${quotas.length} 个模型有免费额度数据。`
  );

  return { count: quotas.length, elapsedMs, updatedAt, models: quotas };
}

async function processPending(state: FetchTriggerState): Promise<void> {
  console.log(
    `[fetch-watcher] 处理触发请求 ${state.requestId}（${state.requestedAt}）`
  );

  const runningState: FetchTriggerState = {
    ...state,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  writeTriggerState(runningState);

  try {
    // 用户在容器侧 logout 后再次 login：容器删不到宿主机的 .session.json，
    // 由 trigger.forceFreshLogin 把"必须重新认证"的意图传过来，watcher 在这里强制清 session
    if (state.forceFreshLogin && consoleScraper.sessionExists()) {
      console.log(
        `[fetch-watcher] forceFreshLogin=true，清掉宿主机旧 session 强制重新登录`
      );
      consoleScraper.clearSession();
      markSessionInvalid("cleared");
    }

    // intent 缺省视作 login（兼容旧客户端）；fetch 意图禁止任何浏览器弹窗
    const isFetchOnly = state.intent === "fetch";
    // 一次 processPending 至多只允许弹一次浏览器：ensureSession 之后若 scrape 仍报
    // session 失效，更可能是接口侧瞬时问题，再 login 一次只会冗余弹窗。
    let browserOpened = false;

    if (isFetchOnly) {
      // 刷新数据：session 不可用直接报错；不再自动写 logout marker —— 否则用户在
      // /source-config 加了一条 URL 回到首页，遇到一次接口侧瞬时 NotLogined
      // 就会被踢回未登录态。让用户看 toast 上的错误自行决定是否重登。
      if (!consoleScraper.sessionExists()) {
        // session 文件真没了：把这事告诉容器侧，让前端立刻显示"未登录"，
        // 用户看见状态翻转就知道要主动登录，而不是反复保存配置碰运气。
        markSessionInvalid("missing");
        throw makeError(
          "登录已失效，请点击「登录阿里云账号」重新认证",
          "SESSION_EXPIRED"
        );
      }
      // session 文件存在但内容无效（例如 storageState 丢失了 auth cookies）
      const valid = await consoleScraper.isSessionValid();
      if (!valid) {
        markSessionInvalid("expired");
        throw makeError(
          "登录已失效，请稍后重试或重新登录阿里云账号",
          "SESSION_EXPIRED"
        );
      }
    } else {
      const sessionWasMissing =
        !consoleScraper.sessionExists() ||
        !(await consoleScraper.isSessionValid());
      await ensureSession();
      if (sessionWasMissing) {
        browserOpened = true;
      }
    }

    let result: FetchTriggerResult;
    try {
      result = await doScrape();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isSessionExpired =
        err instanceof BailianConsoleSessionExpiredError ||
        message.includes("Session expired") ||
        message.includes("login again");
      if (isSessionExpired) {
        if (isFetchOnly || browserOpened) {
          // 已为本次请求弹过浏览器，或 fetch-only：不再二次 login，也不写 logout marker。
          // session 可能只是接口侧瞬时返回 NotLogined，下一次刷新仍能成功；
          // 即便真的过期，仍交由用户主动「退出登录 → 重新登录」去刷新认证状态。
          console.log(
            "[fetch-watcher] 抓取时 session 失效，不再二次弹浏览器（保留 session 文件，不写 marker）"
          );
          throw makeError(
            "登录已失效，请稍后重试或重新登录阿里云账号",
            "SESSION_EXPIRED"
          );
        }
        console.log("[fetch-watcher] 抓取时 session 失效，重新登录后重试...");
        await consoleScraper.login();
        browserOpened = true;
        result = await doScrape();
      } else {
        throw err;
      }
    }

    writeTriggerState({
      ...runningState,
      status: "done",
      completedAt: new Date().toISOString(),
      result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let code = (err as ScrapeError).code;
    if (!code) {
      if (err instanceof BailianConsoleSessionExpiredError) {
        code = "SESSION_EXPIRED";
      } else if (message.includes("Executable doesn't exist")) {
        code = "NO_BROWSER";
      } else if (
        message.includes("Session expired") ||
        message.includes("login again")
      ) {
        code = "SESSION_EXPIRED";
      } else {
        code = "FETCH_FAILED";
      }
    }
    console.error(`[fetch-watcher] 失败 ${state.requestId}: ${message}`);
    writeTriggerState({
      ...runningState,
      status: "error",
      completedAt: new Date().toISOString(),
      error: message,
      code,
    });
  }
}

async function main(): Promise<void> {
  console.log("[fetch-watcher] 启动 Bailian 抓取 watcher 守护进程");
  console.log(`[fetch-watcher] 监听文件: ${getTriggerFilePath()}`);
  console.log(
    "[fetch-watcher] Docker 容器内点击「刷新」按钮即会触发本进程执行抓取"
  );
  console.log("[fetch-watcher] 按 Ctrl+C 停止\n");

  // 启动时同步一次 session 状态：验证文件存在性 + API 可用性，
  // 避免容器侧 /api/auth 在 session 实际已失效时仍显示"已登录"。
  if (consoleScraper.sessionExists()) {
    console.log("[fetch-watcher] 启动时检测到本地 session 文件，正在验证有效性...");
    const valid = await consoleScraper.isSessionValid();
    if (valid) {
      markSessionValid();
      console.log("[fetch-watcher] Session 验证通过，标记为 valid");
    } else {
      markSessionInvalid("expired");
      console.log(
        "[fetch-watcher] Session 验证失败，已自动清除。请重新登录阿里云账号。"
      );
    }
  } else {
    markSessionInvalid("missing");
    console.log(
      "[fetch-watcher] 启动时未发现本地 session 文件，标记为 invalid（容器侧前端将显示未登录）"
    );
  }

  // 启动时清理僵尸 running / pending（前次进程异常退出留下的）
  const initial = readTriggerState();
  if (initial && isTriggerStale(initial)) {
    console.warn(
      `[fetch-watcher] 启动时发现僵尸 ${initial.status} ${initial.requestId}，标记为 error`
    );
    writeTriggerState({
      ...initial,
      status: "error",
      completedAt: new Date().toISOString(),
      error: `watcher 重启，前次抓取未完成（状态=${initial.status}）`,
      code: "STALE",
    });
  }

  let lastIdleLogAt = 0;
  let lastStateSignature: string | null = null;

  while (true) {
    try {
      const state = readTriggerState();
      if (state) {
        const stateSignature = `${state.requestId}:${state.status}:${state.completedAt || state.startedAt || ""}`;
        if (stateSignature !== lastStateSignature) {
          lastStateSignature = stateSignature;
          const requestedAt = state.requestedAt
            ? ` requestedAt=${state.requestedAt}`
            : "";
          const detail =
            state.status === "done"
              ? ` count=${state.result?.count ?? "unknown"}`
              : state.status === "error"
                ? ` error=${state.error || state.code || "unknown"}`
                : "";
          console.log(
            `[fetch-watcher] 触发文件状态 ${state.status} requestId=${state.requestId}${requestedAt}${detail}`
          );
        }

        if (state.status === "pending") {
          console.log(
            `[fetch-watcher] 发现 pending 请求 ${state.requestId}（${state.requestedAt}）intent=${state.intent || "fetch"}`
          );
          await processPending(state);
        } else if (state.status === "running" && isTriggerStale(state)) {
          console.warn(
            `[fetch-watcher] 检测到僵尸 running ${state.requestId}，标记为 error`
          );
          writeTriggerState({
            ...state,
            status: "error",
            completedAt: new Date().toISOString(),
            error: "处理超时或 watcher 异常",
            code: "STALE",
          });
        } else if (state.status === "done" || state.status === "error") {
          // done/error 超过 30 分钟则清理，避免日志被旧状态刷屏
          const completedAt = state.completedAt || state.requestedAt;
          if (completedAt && Date.now() - new Date(completedAt).getTime() > 30 * 60 * 1000) {
            console.log(`[fetch-watcher] 清理超时的 ${state.status} 触发文件（${state.requestId}）`);
            try {
              fs.unlinkSync(getTriggerFilePath());
            } catch { /* ignore */ }
          }
        }
      } else if (Date.now() - lastIdleLogAt > IDLE_LOG_INTERVAL_MS) {
        lastIdleLogAt = Date.now();
        lastStateSignature = null;
        console.log(
          `[fetch-watcher] 等待刷新触发文件: ${getTriggerFilePath()}`
        );
      }
    } catch (err) {
      console.error(
        "[fetch-watcher] 循环错误:",
        err instanceof Error ? err.message : String(err)
      );
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(
    "[fetch-watcher] 致命错误:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
