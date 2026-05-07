/**
 * 独立数据抓取脚本
 * 不启动前端服务器，直接调用 Playwright 抓取并写入 ./data/quotas.json
 *
 * 使用方式：
 *   npx tsx scripts/fetch-data.ts
 *
 * 流程：
 *   1. 检查是否有已保存的 session
 *   2. 没有则弹出浏览器登录
 *   3. 登录完成后抓取模型额度数据
 *   4. 结果写入 data/quotas.json（Docker 容器会读取此文件）
 */

import { consoleScraper } from "@/lib/data/console-scraper";
import { loadSourceConfig } from "@/lib/data/source-config";
import { clearLoggedOutMarker } from "@/lib/data/file-loader";
import { filterModelsBySourceUrls } from "@/lib/data/model-filters";
import fs from "node:fs";
import path from "node:path";

async function doScrape(): Promise<number> {
  const config = loadSourceConfig();
  if (config.sourceUrls.length === 0) {
    console.error("错误：没有配置抓取页面。");
    console.error("请先访问 http://localhost:3010/source-config 配置模型广场链接。");
    process.exit(1);
  }

  console.log(`\n开始抓取 ${config.sourceUrls.length} 个页面...`);
  const scrapedQuotas = await consoleScraper.scrapeQuotas(config.sourceUrls);
  const quotas = filterModelsBySourceUrls(scrapedQuotas, config.sourceUrls);
  if (quotas.length !== scrapedQuotas.length) {
    console.log(
      `\n按配置页面过滤结果：${scrapedQuotas.length} -> ${quotas.length} 个模型。`
    );
  }
  console.log(`\n抓取完成！共 ${quotas.length} 个模型有免费额度数据。`);

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dataPath = path.join(dataDir, "quotas.json");
  const data = {
    models: quotas,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf8");

  // 抓取成功 → 清掉旧 logout marker
  clearLoggedOutMarker();

  console.log(`\n数据已写入：${dataPath}`);
  console.log("Docker 容器会自动读取此文件，刷新 http://localhost:3010 即可查看。");
  return quotas.length;
}

async function main() {
  // 1. 检查 session，没有或过期则登录
  const ensureSession = async () => {
    if (!consoleScraper.sessionExists()) {
      console.log("============================================");
      console.log("未找到登录 session，将打开浏览器进行登录...");
      console.log("请在弹出的浏览器窗口中完成阿里云登录。");
      console.log("登录完成后浏览器会自动关闭，脚本会继续执行抓取。");
      console.log("============================================");
      await consoleScraper.login();
      console.log("登录完成！");
      return;
    }

    const valid = await consoleScraper.isSessionValid();
    if (!valid) {
      console.log("Session 已过期，将重新登录...");
      await consoleScraper.login();
    } else {
      console.log("Session 有效，直接开始抓取...");
    }
  };

  await ensureSession();

  try {
    await doScrape();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Session expired") || msg.includes("login again")) {
      console.log("\n抓取时 session 过期，将重新登录后重试一次...");
      await consoleScraper.login();
      await doScrape();
    } else {
      throw e;
    }
  }
}

main().catch((e) => {
  console.error("\n抓取失败:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
