import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  consoleScraper,
  BailianConsoleSessionExpiredError,
} from "@/lib/data/console-scraper";
import { loadSourceConfig, getSourceUrlsPreview } from "@/lib/data/source-config";
import { clearCache, setConsoleCache } from "@/lib/data/api";
import { clearLoggedOutMarker } from "@/lib/data/file-loader";
import { filterModelsBySourceUrls } from "@/lib/data/model-filters";
import {
  readTriggerState,
  writeTriggerState,
  isTriggerStale,
  generateRequestId,
  type FetchTriggerState,
} from "@/lib/data/fetch-trigger";

export const runtime = "nodejs";
export const maxDuration = 300;

let isRunning = false;
let runningSince = 0;
const DIRECT_MODE_STALE_MS = 10 * 60 * 1000; // 10 分钟认为 direct mode 的 isRunning 已僵尸

const FETCH_MODE = process.env.FETCH_MODE; // "trigger" 时走 watcher 桥接

function statusFromErrorCode(code?: string): number {
  switch (code) {
    case "NO_SESSION":
    case "SESSION_EXPIRED":
      return 401;
    case "NO_SOURCES":
      return 400;
    case "NO_BROWSER":
      return 503;
    case "ALREADY_RUNNING":
      return 409;
    case "WATCHER_TIMEOUT":
      return 504;
    default:
      return 500;
  }
}

async function handleDirectMode() {
  // 自修复：如果 isRunning 超过 10 分钟，认为前次请求已僵尸，允许新请求
  if (isRunning && Date.now() - runningSince < DIRECT_MODE_STALE_MS) {
    console.log(`[fetch-data API] direct mode 拒绝请求：已有任务运行中（${Date.now() - runningSince}ms）`);
    return NextResponse.json(
      { error: "已有抓取任务正在运行，请稍候再试", code: "ALREADY_RUNNING" },
      { status: 409 }
    );
  }
  if (isRunning && Date.now() - runningSince >= DIRECT_MODE_STALE_MS) {
    console.warn(`[fetch-data API] direct mode 检测到僵尸 isRunning（${Date.now() - runningSince}ms），自动重置`);
  }

  isRunning = true;
  runningSince = Date.now();
  console.log("[fetch-data API] direct mode 开始抓取...");

  try {
    const config = loadSourceConfig();
    if (config.sourceUrls.length === 0) {
      console.log("[fetch-data API] direct mode 无配置来源");
      return NextResponse.json(
        {
          error: "请先在 /source-config 配置要抓取的模型广场页面",
          code: "NO_SOURCES",
        },
        { status: 400 }
      );
    }

    if (!consoleScraper.sessionExists()) {
      console.log("[fetch-data API] direct mode 无 session");
      return NextResponse.json(
        {
          error: "未登录阿里云账号，请先点击右上角「登录阿里云账号」",
          code: "NO_SESSION",
        },
        { status: 401 }
      );
    }

    const sessionValid = await consoleScraper.isSessionValid();
    if (!sessionValid) {
      console.log("[fetch-data API] direct mode session 已过期");
      return NextResponse.json(
        {
          error: "登录已过期，请重新点击「登录阿里云账号」",
          code: "SESSION_EXPIRED",
        },
        { status: 401 }
      );
    }

    console.log(`[fetch-data API] direct mode 开始 scrapeQuotas，${config.sourceUrls.length} 个来源...`);
    const startedAt = Date.now();
    const scrapedQuotas = await consoleScraper.scrapeQuotas(config.sourceUrls);
    const quotas = filterModelsBySourceUrls(scrapedQuotas, config.sourceUrls);
    if (quotas.length !== scrapedQuotas.length) {
      console.log(
        `[fetch-data API] direct mode 按配置页面过滤结果：${scrapedQuotas.length} -> ${quotas.length} 个模型`
      );
    }
    const elapsedMs = Date.now() - startedAt;
    console.log(`[fetch-data API] direct mode 抓取完成，${quotas.length} 个模型，耗时 ${elapsedMs}ms`);

    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
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

    // 抓取成功 → 清掉旧 logout marker，让 auth/data 状态恢复登录
    clearLoggedOutMarker();
    clearCache();
    setConsoleCache(quotas, config.sourceUrls);

    return NextResponse.json({
      success: true,
      count: quotas.length,
      elapsedMs,
      updatedAt,
      models: quotas,
      sourceUrlCount: config.sourceUrls.length,
      sourceUrlsPreview: getSourceUrlsPreview(config.sourceUrls),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof BailianConsoleSessionExpiredError) {
      return NextResponse.json(
        {
          error: "抓取过程中登录失效，请重新登录",
          code: "SESSION_EXPIRED",
        },
        { status: 401 }
      );
    }

    if (message.includes("Executable doesn't exist")) {
      return NextResponse.json(
        {
          error:
            "本环境未安装 Playwright 浏览器（容器或 CI 环境）。请在宿主机执行：npm install 或 npx playwright install chromium",
          code: "NO_BROWSER",
        },
        { status: 503 }
      );
    }

    console.error("[fetch-data API] direct mode 抓取失败:", error);
    return NextResponse.json(
      { error: message || "抓取失败", code: "FETCH_FAILED" },
      { status: 500 }
    );
  } finally {
    isRunning = false;
    runningSince = 0;
  }
}

async function handleTriggerMode() {
  // 检查现有触发文件，避免并发请求。
  // running / pending 都需要保护；只有 stale（超过 10 分钟）才允许覆盖。
  const existing = readTriggerState();
  console.log(`[fetch-data API] 收到抓取请求，现有触发文件状态: ${existing?.status || "无"}`);
  if (
    existing &&
    (existing.status === "running" || existing.status === "pending") &&
    !isTriggerStale(existing)
  ) {
    console.log(`[fetch-data API] 拒绝请求：已有 ${existing.status} 任务 ${existing.requestId}`);
    return NextResponse.json(
      {
        error: "已有抓取任务正在运行，请稍候再试",
        code: "ALREADY_RUNNING",
      },
      { status: 409 }
    );
  }

  // 写 pending 触发请求
  const requestId = generateRequestId();
  const initial: FetchTriggerState = {
    requestId,
    status: "pending",
    requestedAt: new Date().toISOString(),
    intent: "fetch",
  };
  try {
    writeTriggerState(initial);
    console.log(`[fetch-data API] 已写 pending 触发文件 requestId=${requestId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[fetch-data API] 写触发文件失败:", err);
    return NextResponse.json(
      {
        error: `写入触发文件失败：${msg}（请确认 docker-compose 数据卷为可写挂载）`,
        code: "TRIGGER_WRITE_FAILED",
      },
      { status: 500 }
    );
  }

  // 轮询 watcher 处理结果（5 分钟超时与 maxDuration 对齐）
  const POLL_INTERVAL_MS = 1500;
  const TIMEOUT_MS = 5 * 60 * 1000;
  const start = Date.now();
  let pollCount = 0;

  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const state = readTriggerState();
    pollCount++;

    // 触发文件可能短暂为 null（被原子写或宿主机正在重写），视为暂态继续轮询
    if (!state) {
      if (pollCount % 10 === 0) {
        console.log(`[fetch-data API] 轮询 #${pollCount}: 触发文件短暂不可读，继续等待...`);
      }
      continue;
    }

    // 触发文件 requestId 不一致 = 被其他请求覆盖
    if (state.requestId !== requestId) {
      console.error(`[fetch-data API] 触发文件 requestId 不匹配: 期望=${requestId}, 实际=${state.requestId}`);
      return NextResponse.json(
        {
          error: "触发文件被其他请求覆盖，请重试",
          code: "TRIGGER_OVERWRITTEN",
        },
        { status: 500 }
      );
    }

    if (state.status === "done" && state.result) {
      console.log(`[fetch-data API] 轮询 #${pollCount}: watcher 完成，返回结果`);
      clearCache();
      const sourceConfig = loadSourceConfig();

      // 优先从触发文件 result 中读取 models（fetch-watcher v2 直接把 models 写回触发文件），
      // 避免依赖 quotas.json 被其他进程覆盖导致读到旧数据。
      let models: unknown[] = state.result.models ?? [];

      // 若触发文件里没有 models（旧版 watcher），再从 quotas.json 兜底读取，并做一致性校验
      if (!Array.isArray(models) || models.length === 0) {
        const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
        const dataPath = path.join(dataDir, "quotas.json");
        try {
          const raw = fs.readFileSync(dataPath, "utf8");
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (Array.isArray(parsed.models)) {
            // 一致性校验：quotas.json 的 updatedAt 必须和触发文件结果一致，
            // 否则说明文件被其他进程覆盖，读到的是旧数据
            const fileUpdatedAt =
              typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
            if (fileUpdatedAt === state.result.updatedAt) {
              models = parsed.models;
            } else {
              console.warn(
                `[fetch-data API] quotas.json updatedAt (${fileUpdatedAt}) 与触发文件 result.updatedAt (${state.result.updatedAt}) 不一致，可能读到旧数据。返回空数组。`
              );
            }
          }
        } catch {
          // 文件读取失败则返回空数组，由前端根据 count 判断
        }
      }

      const scopedModels = Array.isArray(models)
        ? filterModelsBySourceUrls(
            models as import("@/lib/data/types").ModelQuota[],
            sourceConfig.sourceUrls
          )
        : [];
      if (Array.isArray(models) && scopedModels.length !== models.length) {
        console.log(
          `[fetch-data API] trigger mode 按配置页面过滤结果：${models.length} -> ${scopedModels.length} 个模型`
        );
      }

      console.log(`[fetch-data API] 返回结果: count=${scopedModels.length}, models数组长度=${scopedModels.length}`);
      // trigger 模式下也要把缓存写入，否则 /api/models 之后读到空缓存会返回 fetching/no_sources
      setConsoleCache(scopedModels, sourceConfig.sourceUrls);
      return NextResponse.json({
        success: true,
        ...state.result,
        count: scopedModels.length,
        models: scopedModels,
        sourceUrlCount: sourceConfig.sourceUrls.length,
        sourceUrlsPreview: getSourceUrlsPreview(sourceConfig.sourceUrls),
      });
    }

    if (state.status === "error") {
      console.log(`[fetch-data API] 轮询 #${pollCount}: watcher 报错: ${state.error}`);
      return NextResponse.json(
        {
          error: state.error || "抓取失败",
          code: state.code || "FETCH_FAILED",
        },
        { status: statusFromErrorCode(state.code) }
      );
    }

    if (state.status === "running" && pollCount % 10 === 0) {
      console.log(`[fetch-data API] 轮询 #${pollCount}: watcher 仍在处理中...`);
    }
  }

  console.error(`[fetch-data API] 轮询超时（${pollCount} 次，${Date.now() - start}ms），watcher 未响应`);
  return NextResponse.json(
    {
      error:
        "等待宿主机 watcher 处理超时。请确认宿主机已运行 `npm run fetch-watcher`",
      code: "WATCHER_TIMEOUT",
    },
    { status: 504 }
  );
}

export async function POST() {
  if (FETCH_MODE === "trigger") {
    return handleTriggerMode();
  }
  return handleDirectMode();
}

export async function GET() {
  if (FETCH_MODE === "trigger") {
    const state = readTriggerState();
    return NextResponse.json({
      mode: "trigger",
      isRunning:
        state?.status === "pending" || state?.status === "running",
      state,
    });
  }
  return NextResponse.json({ mode: "direct", isRunning });
}
