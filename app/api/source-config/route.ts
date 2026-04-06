import { NextResponse } from "next/server";
import { clearCache } from "@/lib/data/api";
import {
  getSourceUrlsPreview,
  loadSourceConfig,
  saveSourceConfig,
} from "@/lib/data/source-config";

export async function GET() {
  const config = loadSourceConfig();

  return NextResponse.json({
    ...config,
    sourceUrlCount: config.sourceUrls.length,
    sourceUrlsPreview: getSourceUrlsPreview(config.sourceUrls),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const config = saveSourceConfig(body.sourceUrls || []);
    clearCache();

    return NextResponse.json({
      ok: true,
      ...config,
      sourceUrlCount: config.sourceUrls.length,
      sourceUrlsPreview: getSourceUrlsPreview(config.sourceUrls),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存抓取配置失败";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
