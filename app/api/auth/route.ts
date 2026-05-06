/**
 * GET  /api/auth  – check login status
 * POST /api/auth  – { action: "login" | "logout" | "refresh" }
 */
import { NextResponse } from "next/server";
import { consoleScraper } from "@/lib/data/console-scraper";
import { clearCache } from "@/lib/data/api";
import { quotaFileExists } from "@/lib/data/file-loader";

export async function GET() {
  try {
    // Docker 模式：数据文件存在即视为已登录（数据来自宿主机抓取）
    if (process.env.DATA_DIR && quotaFileExists()) {
      return NextResponse.json({
        loggedIn: true,
        reason: null,
        mode: "docker",
      });
    }

    const hasSession = consoleScraper.sessionExists();
    return NextResponse.json({
      loggedIn: hasSession,
      reason: hasSession ? null : "no_session",
    });
  } catch (e) {
    return NextResponse.json(
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
        // Launch visible browser — fire and keep going async (login can take minutes).
        // But first verify Playwright can find Chromium by attempting a quick launch.
        try {
          const { chromium } = await import("playwright");
          const exePath = chromium.executablePath();
          const { existsSync } = await import("fs");
          if (!existsSync(exePath)) {
            return NextResponse.json(
              {
                ok: false,
                message: `Chromium 未找到（${exePath}）。请在 bailian-dashboard 目录执行：npx playwright install chromium`,
              },
              { status: 503 }
            );
          }
        } catch (e) {
          return NextResponse.json(
            { ok: false, message: `Playwright 检查失败：${String(e)}` },
            { status: 503 }
          );
        }

        // Run login async so the HTTP request can return immediately.
        // If it fails, the session file will not be written.
        consoleScraper.login().catch((e) => {
          console.error("[auth/login] 登录流程出错:", e);
        });

        return NextResponse.json({
          ok: true,
          message:
            "浏览器已打开，请在弹出的窗口中完成阿里云登录，然后回到这里点击「刷新」。" +
            "如果登录完成后仍然提示未登录，请检查是否正确通过阿里云账号密码或扫码完成了认证。",
        });
      }

      case "logout": {
        consoleScraper.clearSession();
        clearCache();
        return NextResponse.json({ ok: true, message: "Session cleared." });
      }

      case "refresh": {
        // Force re-scrape (clear cache, keep session)
        clearCache();
        return NextResponse.json({ ok: true, message: "Cache cleared. Next data fetch will re-scrape." });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
