/**
 * GET  /api/auth  – check login status
 * POST /api/auth  – { action: "login" | "logout" | "refresh" }
 */
import { NextResponse } from "next/server";
import { consoleScraper } from "@/lib/data/console-scraper";
import { clearCache } from "@/lib/data/api";
import {
  quotaFileExists,
  isLoggedOutMarked,
  markLoggedOut,
  clearLoggedOutMarker,
} from "@/lib/data/file-loader";
import {
  readTriggerState,
  writeTriggerState,
  isTriggerStale,
  generateRequestId,
  type FetchTriggerState,
} from "@/lib/data/fetch-trigger";
import {
  readSessionStatus,
  markSessionInvalid,
} from "@/lib/data/session-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FETCH_MODE = process.env.FETCH_MODE; // "trigger" 时容器内无 Playwright，登录走 watcher 桥接
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function authJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

export async function GET() {
  try {
    // 容器侧 marker 优先：marker 存在直接判定未登录（包括 dev 模式）
    if (isLoggedOutMarked()) {
      return authJson({
        loggedIn: false,
        reason: "logged_out",
      });
    }

    // Docker 模式（FETCH_MODE=trigger）：宿主机 watcher 才知道 .session.json 真实状态，
    // 这里先看它写的共享文件；只有共享文件缺失（首次启动 watcher 没跑）时才回退到
    // "data 文件存在 + 未登出"的旧推断。
    if (process.env.DATA_DIR) {
      const sessionStatus = readSessionStatus();
      if (sessionStatus) {
        return authJson({
          loggedIn: sessionStatus.valid,
          reason: sessionStatus.valid
            ? null
            : sessionStatus.lastInvalidReason || "session_invalid",
          mode: "docker",
          lastValidatedAt: sessionStatus.lastValidatedAt,
        });
      }

      // 兼容兜底：watcher 还没写过状态，沿用旧逻辑避免老部署一启动就显示未登录
      if (quotaFileExists()) {
        return authJson({
          loggedIn: true,
          reason: null,
          mode: "docker",
        });
      }

      return authJson({
        loggedIn: false,
        reason: "no_session_status",
        mode: "docker",
      });
    }

    const hasSession = consoleScraper.sessionExists();
    return authJson({
      loggedIn: hasSession,
      reason: hasSession ? null : "no_session",
      mode: FETCH_MODE === "trigger" ? "trigger" : "direct",
    });
  } catch (e) {
    return authJson(
      { loggedIn: false, reason: "error", message: String(e) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { action } = await request.json();

    switch (action) {
      case "login": {
        // 用户主动发起登录，先记录此前是否被标记为 logout —— 这决定 watcher 是否要清掉宿主机旧 session
        // 关键：容器内删不到宿主机的 .session.json，必须把"用户主动重登"的意图通过 trigger 字段带过去
        const wasLoggedOut = isLoggedOutMarked();
        clearLoggedOutMarker();

        // Docker 模式：容器内没有 Playwright/Chromium，无法直接弹浏览器。
        // 改为写一份 fetch-trigger，由宿主机 fetch-watcher 通过 ensureSession() 弹出浏览器并完成登录+抓取。
        if (FETCH_MODE === "trigger") {
          const existing = readTriggerState();
          if (
            existing &&
            (existing.status === "pending" || existing.status === "running") &&
            !isTriggerStale(existing)
          ) {
            return authJson({
              ok: true,
              message:
                "已有抓取/登录任务正在进行，请在宿主机弹出的浏览器中完成登录。",
            });
          }

          const requestId = generateRequestId();
          const initial: FetchTriggerState = {
            requestId,
            status: "pending",
            requestedAt: new Date().toISOString(),
            forceFreshLogin: wasLoggedOut,
            intent: "login",
          };
          try {
            writeTriggerState(initial);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[auth/login] 写登录触发文件失败:", err);
            return authJson(
              {
                ok: false,
                message: `写入登录触发文件失败：${msg}（请确认 docker-compose 数据卷为可写挂载）`,
              },
              { status: 500 }
            );
          }

          return authJson({
            ok: true,
            message:
              "已通知宿主机弹出浏览器登录阿里云账号。请在弹出的浏览器窗口中完成登录，登录完成后会自动抓取数据。" +
              "如果浏览器没有弹出，请确认宿主机已运行 npm run fetch-watcher。",
          });
        }

        // Dev 模式：直接在本进程内通过 Playwright 弹浏览器，先确认 Chromium 可用
        try {
          const { chromium } = await import("playwright");
          const exePath = chromium.executablePath();
          const { existsSync } = await import("fs");
          if (!existsSync(exePath)) {
            return authJson(
              {
                ok: false,
                message: `Chromium 未找到（${exePath}）。请在 bailian-dashboard 目录执行：npx playwright install chromium`,
              },
              { status: 503 }
            );
          }
        } catch (e) {
          return authJson(
            { ok: false, message: `Playwright 检查失败：${String(e)}` },
            { status: 503 }
          );
        }

        // Run login async so the HTTP request can return immediately.
        // If it fails, the session file will not be written.
        consoleScraper.login().catch((e) => {
          console.error("[auth/login] 登录流程出错:", e);
        });

        return authJson({
          ok: true,
          message:
            "浏览器已打开，请在弹出的窗口中完成阿里云登录，然后回到这里点击「刷新」。" +
            "如果登录完成后仍然提示未登录，请检查是否正确通过阿里云账号密码或扫码完成了认证。",
        });
      }

      case "logout": {
        consoleScraper.clearSession();
        clearCache();
        // Docker 模式下 .session.json 不在容器内，需要靠 marker 表达 logout 意图；
        // dev 模式下已经 clearSession，再写 marker 是幂等的兜底。
        markLoggedOut();
        // 同步共享文件：watcher 真正清宿主机 session 之前，先让 /api/auth GET 立刻显示"未登录"，
        // 否则 logout marker 被 watcher 抓取成功后清掉，旧的 valid 状态会回潮。
        markSessionInvalid("cleared");
        return authJson({ ok: true, message: "Session cleared." });
      }

      case "refresh": {
        // Force re-scrape (clear cache, keep session)
        clearCache();
        return authJson({ ok: true, message: "Cache cleared. Next data fetch will re-scrape." });
      }

      default:
        return authJson({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return authJson({ error: String(e) }, { status: 500 });
  }
}
