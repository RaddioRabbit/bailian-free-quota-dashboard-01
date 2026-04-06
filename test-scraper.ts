/**
 * Test script for BailianConsoleScraper
 * Usage: npx ts-node test-scraper.ts
 */

import { consoleScraper } from "./lib/data/console-scraper";
import { loadSourceConfig } from "./lib/data/source-config";

async function main() {
  console.log("========================================");
  console.log("Bailian Console Scraper Test");
  console.log("========================================\n");

  // Check if session exists
  const hasSession = consoleScraper.sessionExists();
  console.log(`Session exists: ${hasSession}`);

  if (!hasSession) {
    console.log("\nNo session found. Please login first:");
    console.log("1. Run the dashboard: npm run dev");
    console.log('2. Click "Login" button in the UI');
    console.log("3. Complete login in the browser window");
    console.log("4. Close the browser window manually");
    console.log("5. Run this test again\n");
    return;
  }

  const sourceConfig = loadSourceConfig();
  if (sourceConfig.sourceUrls.length === 0) {
    console.log("\nNo source URLs configured. Please add one or more model market pages first.");
    console.log('Open the dashboard and click "抓取配置"，每行填写一个模型广场链接。\n');
    return;
  }

  // Validate session
  console.log("\nValidating session...");
  const isValid = await consoleScraper.isSessionValid();
  console.log(`Session valid: ${isValid}`);

  if (!isValid) {
    console.log("\nSession is invalid or expired. Please login again.");
    return;
  }

  // Scrape quotas
  console.log("\n========================================");
  console.log("Scraping quota data...");
  console.log("========================================\n");

  try {
    const quotas = await consoleScraper.scrapeQuotas(sourceConfig.sourceUrls);

    console.log("\n========================================");
    console.log(`Successfully scraped ${quotas.length} models:`);
    console.log("========================================\n");

    for (const quota of quotas) {
      console.log(`Model: ${quota.modelName}`);
      console.log(`  Total: ${quota.totalQuota.toLocaleString()} ${quota.unit}`);
      console.log(`  Used: ${quota.usedQuota.toLocaleString()} ${quota.unit}`);
      console.log(`  Remaining: ${quota.remainingQuota.toLocaleString()} ${quota.unit}`);
      console.log(`  Expires: ${new Date(quota.expiresAt).toLocaleDateString()}`);
      if (quota.capabilityTags?.length) {
        console.log(`  Tags: ${quota.capabilityTags.join(" / ")}`);
      }
      console.log("");
    }
  } catch (e) {
    console.error("\nError scraping quotas:", e);
    process.exit(1);
  }
}

main().catch(console.error);
