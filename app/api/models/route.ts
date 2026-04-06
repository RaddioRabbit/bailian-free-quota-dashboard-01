import { NextResponse } from "next/server";
import { getDashboardData, verifyApiKey, clearCache } from "@/lib/data/api";
import { BailianScraperError } from "@/lib/data/bailian-scraper";

/**
 * GET /api/models
 * Server-side endpoint that returns model quota data.
 * All credentials (if any) stay on the server.
 *
 * Headers:
 * - X-API-Key: 阿里云百炼API Key（可选，也可使用环境变量）
 */
export async function GET(request: Request) {
  try {
    // 从请求头获取API Key
    const headers = request.headers;
    const apiKeyFromHeader = headers.get("X-API-Key");

    // 获取数据
    const data = await getDashboardData(apiKeyFromHeader || undefined, {
      useCache: true,
      useMockOnFailure: true, // API失败时使用模拟数据
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("API Error:", error);

    // 根据错误类型返回不同的状态码
    if (error instanceof BailianScraperError) {
      const statusCode = error.statusCode || 500;

      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          models: [], // 返回空数组而不是失败
          updatedAt: new Date().toISOString(),
        },
        { status: statusCode }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: message,
        code: "INTERNAL_ERROR",
        models: [],
        updatedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/models
 * 用于验证API Key或强制刷新数据
 *
 * Body:
 * - action: "verify" | "refresh"
 * - apiKey?: string (可选)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, apiKey } = body;

    // 从请求头获取API Key（如果body中没有）
    const headers = request.headers;
    const apiKeyFromHeader = headers.get("X-API-Key");
    const effectiveApiKey = apiKey || apiKeyFromHeader;

    switch (action) {
      case "verify": {
        // 验证API Key
        const result = await verifyApiKey(effectiveApiKey || undefined);
        return NextResponse.json(result);
      }

      case "refresh": {
        // 清除缓存并重新获取数据
        clearCache();
        const data = await getDashboardData(effectiveApiKey || undefined, {
          useCache: false,
          useMockOnFailure: true,
        });
        return NextResponse.json(data);
      }

      default:
        return NextResponse.json(
          { error: "Invalid action. Use 'verify' or 'refresh'" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("API Error:", error);

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
