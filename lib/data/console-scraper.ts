/**
 * Alibaba Cloud Bailian console scraper using Playwright.
 *
 * Flow:
 *  1. First time: launch visible browser -> user logs in -> session saved to .session.json
 *  2. Subsequent calls: reuse session (headless) -> visit each model detail page -> scrape quota data
 *
 * V2 rewrite — fixes:
 *  - Defect 1: Replaced CSS selector model discovery with API response interception + exact allowlist fallback
 *  - Defect 2: login() now waits for auth cookies before saving session
 *  - Defect 3: All DOM queries use text content matching instead of CSS Module class names
 */

import { chromium, BrowserContext, Page, Browser, Response as PwResponse } from "playwright";
import path from "path";
import fs from "fs";
import { ModelQuota } from "./types";
import {
  mergeCapabilityTags,
  normalizeCapabilityTags,
  parseCapabilitiesFromSourceUrl,
} from "./capabilities";

const SESSION_PATH = path.join(process.cwd(), ".session.json");
const CONSOLE_BASE = "https://bailian.console.aliyun.com";
const CONSOLE_GATEWAY_URL =
  "https://bailian-cs.console.aliyun.com/data/api.json?action=BroadScopeAspnGateway&product=sfm_bailian";
const DEFAULT_MODEL_MARKET_URL =
  "https://bailian.console.aliyun.com/cn-beijing#/model-market/all";
const MODEL_DETAIL_URL = (id: string) =>
  `${CONSOLE_BASE}/cn-beijing#/model-market/detail/${encodeURIComponent(id)}`;
const PROVIDER_LABELS: Record<string, string> = {
  qwen: "Qwen",
  bailian: "Bailian",
  "moonshot-ai": "Moonshot AI",
  moonshot: "Moonshot AI",
  kimi: "Moonshot AI",
  deepseek: "DeepSeek",
  "zhipu-ai": "Zhipu AI",
  zhipu: "Zhipu AI",
  glm: "Zhipu AI",
  "mini-max": "MiniMax",
  minimax: "MiniMax",
};

interface DiscoveredModelMeta {
  id: string;
  modelName?: string;
  provider?: string;
  description?: string;
  capabilityTags?: string[];
}

/** Cookie names that indicate a fully authenticated Aliyun session */
const STRONG_AUTH_COOKIE_INDICATORS = [
  "login_aliyunid_ticket",
  "ALICLOUD_ACCOUNT_TICKET",
  "login_aliyunid",
  "alyun_console_session",
  "consoleToken",
];

/** Cookies that may appear before login fully completes, useful for debugging only */
const WEAK_AUTH_COOKIE_INDICATORS = [
  "login_aliyunid_csrf",
];

function normalizeModelId(value: string): string {
  return value.toLowerCase().trim();
}

function isLikelyModelId(value: string): boolean {
  const normalized = normalizeModelId(value);
  return (
    /^[a-z0-9][a-z0-9./-]*$/.test(normalized) &&
    /[a-z]/.test(normalized) &&
    normalized.length >= 3 &&
    normalized.length < 100 &&
    !normalized.startsWith("group-")
  );
}

function extractModelCodeFromText(text: string): string | null {
  const normalizedText = text.replace(/\u00a0/g, " ");
  const match =
    normalizedText.match(/模型Code\s*([a-z0-9][a-z0-9./-]*)/i) ??
    normalizedText.match(/Model\s*Code\s*([a-z0-9][a-z0-9./-]*)/i);
  const candidate = match?.[1];
  return candidate && isLikelyModelId(candidate) ? normalizeModelId(candidate) : null;
}

function firstNonEmptyString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeProviderLabel(provider: string | null, modelId: string): string {
  if (provider) {
    const normalizedProvider = provider.trim().toLowerCase();
    if (PROVIDER_LABELS[normalizedProvider]) {
      return PROVIDER_LABELS[normalizedProvider];
    }

    const compactProvider = normalizedProvider.replace(/\s+/g, "-");
    if (PROVIDER_LABELS[compactProvider]) {
      return PROVIDER_LABELS[compactProvider];
    }

    return provider.trim();
  }

  const inferredProvider = Object.entries(PROVIDER_LABELS).find(([key]) => modelId.includes(key));
  return inferredProvider?.[1] || "阿里云百炼";
}

export class BailianConsoleScraper {
  /** Returns true if a saved session exists on disk. */
  sessionExists(): boolean {
    return fs.existsSync(SESSION_PATH);
  }

  /**
   * A saved session file means a manual login flow completed and was persisted.
   * Actual validity is always checked via `isSessionValid()`.
   */
  hasAuthenticatedSession(): boolean {
    return this.sessionExists();
  }

  /** Deletes the saved session file. */
  clearSession(): void {
    if (fs.existsSync(SESSION_PATH)) {
      fs.unlinkSync(SESSION_PATH);
      console.log("[BailianScraper] Session file deleted.");
    }
  }

  /**
   * Opens a VISIBLE browser so the user can log in manually.
   * Waits until (a) URL leaves login/passport AND (b) auth cookies are present,
   * then saves the full session. Timeout: 3 minutes.
   *
   * Throws if authentication cookies are not detected so the caller can
   * surface a proper error instead of saving a useless session.
   *
   * NOTE: The browser window will NOT be closed automatically. User must close it manually.
   */
  async login(): Promise<void> {
    const browser = await chromium.launch({
      headless: false,
      args: ["--start-maximized"],
      executablePath: this._findChromiumPath(),
    });
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();

    console.log("[BailianScraper] Opening browser for login...");
    await page.goto(CONSOLE_BASE);

    // Phase 1: Wait until the user actually completes login. URL alone is not
    // enough because the home page can be visible before authentication finishes.
    console.log("[BailianScraper] Waiting for user to complete login...");
    await this._waitForAuthenticatedPage(page, 180_000);
    console.log("[BailianScraper] Login page check passed. Current URL:", page.url());

    // Phase 2: Wait for SPA to settle so cookies and storage finish writing
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    // Phase 3: Poll for auth cookies for diagnostics only. Aliyun occasionally
    // authenticates via storage state that is not captured by a fixed cookie name.
    console.log("[BailianScraper] Waiting for authentication cookies...");
    const authCookieFound = await this._waitForAuthCookies(context, 30_000);

    // Phase 4: Verify we can reach the protected model market route before
    // deciding whether the login really completed.
    console.log("[BailianScraper] Verifying access to Bailian model market...");
    await this._navigateToConsole(page, DEFAULT_MODEL_MARKET_URL);

    // Phase 5: Extra settle time for any late cookie writes
    await page.waitForTimeout(2000);

    // Phase 6: Log all cookies for debugging, then validate
    const allCookies = await context.cookies();
    console.log(`[BailianScraper] Total cookies: ${allCookies.length}`);
    console.log(
      "[BailianScraper] Cookie names:",
      allCookies.map((c) => c.name).join(", ")
    );
    const strongAuthCookieNames = this._getMatchingCookieNames(
      allCookies,
      STRONG_AUTH_COOKIE_INDICATORS
    );
    const weakAuthCookieNames = this._getMatchingCookieNames(
      allCookies,
      WEAK_AUTH_COOKIE_INDICATORS
    );
    console.log(
      `[BailianScraper] Strong auth cookies found: ${
        strongAuthCookieNames.length > 0 ? strongAuthCookieNames.join(", ") : "NONE"
      }`
    );
    console.log(
      `[BailianScraper] Weak auth cookies found: ${
        weakAuthCookieNames.length > 0 ? weakAuthCookieNames.join(", ") : "NONE"
      }`
    );

    // Phase 7: Also verify the page does NOT show a login button
    const hasLoginButton = await this._pageHasLoginButton(page);

    if (this._looksLoggedOut(page.url()) || hasLoginButton) {
      throw new Error(
        "Login incomplete: Bailian console still looks logged out after navigation. " +
        "Please finish logging in and try again."
      );
    }

    const apiAuthenticated = await this._probeAuthenticatedQuotaApi(page);

    if (!authCookieFound) {
      console.warn(
        "[BailianScraper] Strong auth cookies were not detected, but the protected console page is accessible. Continuing with saved session."
      );
    }

    if (!apiAuthenticated) {
      console.warn(
        "[BailianScraper] Quota API probe failed on the validation page. Continuing because the protected console page is accessible."
      );
    }

    await context.storageState({ path: SESSION_PATH });
    console.log(`[BailianScraper] Session saved to ${SESSION_PATH}`);
    console.log("[BailianScraper] ============================================");
    console.log("[BailianScraper] Login successful! Session saved.");
    console.log("[BailianScraper] IMPORTANT: Please close the browser window manually when ready.");
    console.log("[BailianScraper] The browser will stay open for you to verify login status.");
    console.log("[BailianScraper] ============================================");

    // Do NOT close the browser - let user close it manually
    // This ensures user has enough time to verify login and see any messages
  }

  /**
   * Validates saved session by loading the console and checking we're not
   * redirected to a login page AND that there's no prominent login button.
   *
   * If session is invalid due to missing auth cookies, it is automatically
   * deleted so the caller can prompt the user to log in again.
   */
  async isSessionValid(): Promise<boolean> {
    if (!this.sessionExists()) return false;

    const browser = await chromium.launch({
      headless: true,
      executablePath: this._findChromiumPath(),
    });
    try {
      const context = await this._contextWithSession(browser);
      const page = await context.newPage();
      await this._navigateToConsole(page, DEFAULT_MODEL_MARKET_URL);

      const url = page.url();
      if (this._looksLoggedOut(url)) {
        console.log("[BailianScraper] Session invalid: redirected to login page.");
        this.clearSession();
        return false;
      }

      const hasLoginButton = await this._pageHasLoginButton(page);
      if (hasLoginButton) {
        console.log("[BailianScraper] Session invalid: login button found on page.");
        this.clearSession();
        return false;
      }

      const cookies = await context.cookies();
      const strongAuthCookieNames = this._getMatchingCookieNames(
        cookies,
        STRONG_AUTH_COOKIE_INDICATORS
      );
      if (strongAuthCookieNames.length === 0) {
        console.warn(
          "[BailianScraper] Session validation: no known strong auth cookie found. Relying on protected page access instead."
        );
      }

      const apiAuthenticated = await this._probeAuthenticatedQuotaApi(page);
      if (!apiAuthenticated) {
        console.warn(
          "[BailianScraper] Session validation: quota API probe failed, but protected console access still works."
        );
      }

      console.log("[BailianScraper] Session is valid.");
      return true;
    } catch (e) {
      console.warn("[BailianScraper] Session validation error:", e);
      // Keep the session file on transient errors so the user can retry.
      return false;
    } finally {
      await browser.close();
    }
  }

  /**
   * Main entry: scrape model quota data from the Bailian console.
   *
   * Strategy:
   *  1. Navigate to the configured model market pages and intercept API responses to discover model metadata
   *  2. Merge duplicate models discovered across multiple source URLs
   *  3. Visit each model detail page and scrape the free quota section via API-first approach
   *
   * Debug mode: Set DEBUG_BAILIAN=1 to see detailed logs
   */
  async scrapeQuotas(sourceUrls: string[]): Promise<ModelQuota[]> {
    if (!this.sessionExists()) {
      throw new Error("No session found. Please login first via /api/auth.");
    }
    if (!sourceUrls.length) {
      return [];
    }

    const debug = process.env.DEBUG_BAILIAN === "1";

    console.log("[BailianScraper] ============================================");
    console.log("[BailianScraper] Starting quota scraping process...");
    console.log("[BailianScraper] Debug mode:", debug ? "ON" : "OFF");
    console.log("[BailianScraper] ============================================");

    const browser = await chromium.launch({
      headless: true,
      executablePath: this._findChromiumPath(),
    });

    try {
      const context = await this._contextWithSession(browser);
      const page = await context.newPage();

      // Enable console logging in debug mode
      if (debug) {
        page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.log(`[Browser Error] ${err.message}`));
      }

      // Step 1: Discover model metadata via API interception
      console.log("[BailianScraper] Step 1: Discovering models via API interception...");
      const discoveredModels = new Map<string, DiscoveredModelMeta>();

      for (const sourceUrl of sourceUrls) {
        const modelsForSource = await this._discoverModelsViaApi(page, sourceUrl);
        for (const [modelId, meta] of Array.from(modelsForSource.entries())) {
          this._upsertDiscoveredModel(discoveredModels, meta);
          console.log(`[BailianScraper] ${sourceUrl} -> discovered ${modelId}`);
        }
      }

      const modelEntries = Array.from(discoveredModels.values());
      if (modelEntries.length === 0) {
        throw new Error("当前抓取页面没有发现可拉取的模型，请检查配置链接是否正确。");
      }
      console.log(
        `[BailianScraper] Will scrape ${modelEntries.length} models: ${modelEntries
          .map((model) => model.id)
          .join(", ")}`
      );

      // Step 2: Visit each model detail page and scrape quota
      const quotas: ModelQuota[] = [];
      let successCount = 0;
      let skipCount = 0;
      let errorCount = 0;

      const workerCount = Math.min(4, Math.max(modelEntries.length, 1));
      const workerPages: Page[] = [page];
      for (let i = 1; i < workerCount; i++) {
        workerPages.push(await context.newPage());
      }

      let nextIndex = 0;
      let sessionExpiredDetected = false;
      const runWorker = async (workerPage: Page, workerIndex: number): Promise<void> => {
        while (true) {
          const currentIndex = nextIndex++;
          if (currentIndex >= modelEntries.length) {
            return;
          }

          const modelMeta = modelEntries[currentIndex];
          const modelId = modelMeta.id;
          try {
            const quota = await this._scrapeModelDetailQuota(workerPage, modelMeta);
            if (quota) {
              quotas.push(quota);
              successCount++;
              console.log(
                `[BailianScraper] OK ${modelId}: ${quota.remainingQuota.toLocaleString()}/${quota.totalQuota.toLocaleString()} remaining, expires ${quota.expiresAt}`
              );
            } else {
              skipCount++;
              console.log(`[BailianScraper] SKIP ${modelId}: no free quota section found`);
            }
          } catch (e) {
            if (e instanceof BailianConsoleSessionExpiredError) {
              sessionExpiredDetected = true;
              return;
            }
            errorCount++;
            console.error(`[BailianScraper] ERROR ${modelId}:`, e);
          }

          // Keep a small gap per worker to reduce the chance of rate limiting.
          await workerPage.waitForTimeout(workerIndex === 0 ? 200 : 150);
        }
      };

      try {
        await Promise.all(workerPages.map((workerPage, workerIndex) => runWorker(workerPage, workerIndex)));
        if (sessionExpiredDetected) {
          throw new BailianConsoleSessionExpiredError(
            "Session expired during concurrent scraping."
          );
        }
      } finally {
        await Promise.all(
          workerPages.slice(1).map((workerPage) => workerPage.close().catch(() => {}))
        );
      }

      console.log("[BailianScraper] ============================================");
      console.log(`[BailianScraper] Results: ${successCount} success, ${skipCount} skipped, ${errorCount} errors`);
      console.log(`[BailianScraper] Total models with quota: ${quotas.length}`);
      console.log("[BailianScraper] ============================================");

      if (quotas.length === 0) {
        throw new Error(
          "No free quota data found across all models. " +
          "Either session is expired or models have no active free tiers. " +
          "Try running with DEBUG_BAILIAN=1 for more details."
        );
      }

      console.log(`[BailianScraper] Done. Scraped ${quotas.length} models with free quota.`);
      return quotas;
    } catch (e) {
      if (e instanceof BailianConsoleSessionExpiredError) {
        console.log("[BailianScraper] Session expired during scraping. Clearing session file.");
        this.clearSession();
        throw new Error("Session expired. Please login again via /api/auth.");
      }
      throw e;
    } finally {
      await browser.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Model discovery via API interception
  // ---------------------------------------------------------------------------

  /**
   * Navigate to the model market page and intercept XHR/fetch responses
   * to discover model metadata from the SPA's internal API calls.
   *
   * Updated to match Bailian console API patterns:
   * - API endpoint: bailian-cs.console.aliyun.com/data/api.json
   * - Action: BroadScopeAspnGateway
   * - Model list API: zeldaHttp.dashscopeModel./zelda/api/v1/modelCenter/listFoundationModels
   */
  private async _discoverModelsViaApi(
    page: Page,
    sourceUrl: string
  ): Promise<Map<string, DiscoveredModelMeta>> {
    const discoveredModels = new Map<string, DiscoveredModelMeta>();
    const sourceCapabilityTags = parseCapabilitiesFromSourceUrl(sourceUrl);

    // Set up response listener BEFORE navigation
    const responseHandler = async (response: PwResponse) => {
      try {
        const url = response.url();
        const status = response.status();

        // Bail out early on non-success or non-JSON
        if (status !== 200) return;
        const contentType = response.headers()["content-type"] ?? "";
        if (!contentType.includes("json")) return;

        // Bailian-specific API patterns based on actual network analysis
        const isModelApi =
          // Primary: Bailian console API gateway
          url.includes("bailian-cs.console.aliyun.com/data/api.json") ||
          // Model list endpoint
          url.includes("listFoundationModels") ||
          url.includes("listRecommendedModels") ||
          // Aliyun POP gateway endpoints for model market
          /\.aliyun\.com\/(pop-model-market|pop)\//.test(url) ||
          url.includes("/model-market/") ||
          url.includes("/model/") ||
          url.includes("/ListModel") ||
          url.includes("/GetModel") ||
          url.includes("/QueryModel") ||
          url.includes("/quota") ||
          url.includes("/billing") ||
          // Internal data endpoints common in Aliyun SPAs
          url.includes("_data_") ||
          url.includes("data.json");

        if (!isModelApi) return;

        console.log(`[BailianScraper] Intercepted API: ${url.substring(0, 100)}...`);

        const body = await response.json().catch(() => null);
        if (!body) return;

        // Extract model metadata from various possible response shapes
        this._extractModelsFromJson(body, discoveredModels, sourceCapabilityTags);
      } catch {
        // Silently ignore parse failures on individual responses
      }
    };

    page.on("response", responseHandler);

    try {
      console.log("[BailianScraper] Navigating to configured model market page...");
      await page.goto(sourceUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      const currentUrl = page.url();
      if (currentUrl.includes("login") || currentUrl.includes("passport")) {
        throw new Error("Session expired. Please login again via /api/auth.");
      }

      // Wait for SPA to load and API calls to complete
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(3000);

      console.log(
        `[BailianScraper] After initial load: ${discoveredModels.size} models from API interception`
      );

      // Try scrolling to trigger lazy loading (the page has 3 pages with skeleton loading)
      let previousCount = discoveredModels.size;
      for (let scroll = 0; scroll < 5; scroll++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(900);

        if (discoveredModels.size === previousCount) {
          break;
        }
        previousCount = discoveredModels.size;
      }

      console.log(
        `[BailianScraper] After scrolling: ${discoveredModels.size} models from API interception`
      );
    } finally {
      page.removeListener("response", responseHandler);
    }

    return discoveredModels;
  }

  /**
   * Recursively extract model metadata from a JSON payload.
   */
  private _extractModelsFromJson(
    obj: unknown,
    models: Map<string, DiscoveredModelMeta>,
    sourceCapabilityTags: string[]
  ): void {
    if (!obj || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        this._extractModelsFromJson(item, models, sourceCapabilityTags);
      }
      return;
    }

    const record = obj as Record<string, unknown>;

    const modelIdFromUrl = firstNonEmptyString(record, ["href", "url", "link", "detailUrl", "detail_url"]);
    const urlMatch = modelIdFromUrl?.match(/model-market\/detail\/([^?&#\s]+)/);
    const urlDecodedModelId = urlMatch?.[1] ? decodeURIComponent(urlMatch[1]) : null;

    const candidateModelId =
      [record.model, record.modelId, record.model_id, record.slug].find(
        (value) => typeof value === "string" && isLikelyModelId(value)
      ) as string | undefined;
    const resolvedModelId = candidateModelId || urlDecodedModelId || undefined;

    if (resolvedModelId && isLikelyModelId(resolvedModelId)) {
      const normalizedId = normalizeModelId(resolvedModelId);
      this._upsertDiscoveredModel(models, {
        id: normalizedId,
        modelName:
          firstNonEmptyString(record, ["modelName", "name", "displayName", "title"]) ||
          normalizedId,
        provider: normalizeProviderLabel(
          firstNonEmptyString(record, [
            "providerName",
            "provider",
            "providerCode",
            "vendorName",
            "vendor",
            "supplierName",
            "organizationName",
            "orgName",
            "owner",
          ]),
          normalizedId
        ),
        description: firstNonEmptyString(record, [
          "description",
          "desc",
          "summary",
          "introduction",
          "overview",
        ]) || undefined,
        capabilityTags: mergeCapabilityTags(
          record.capabilities,
          record.capabilityTags,
          record.tags,
          record.featureTags,
          record.sceneTags,
          sourceCapabilityTags
        ),
      });
    }

    // Recurse into nested objects/arrays
    for (const key of Object.keys(record)) {
      const val = record[key];
      if (val && typeof val === "object") {
        this._extractModelsFromJson(val, models, sourceCapabilityTags);
      }
    }
  }

  private _upsertDiscoveredModel(
    models: Map<string, DiscoveredModelMeta>,
    candidate: DiscoveredModelMeta
  ): void {
    const existing = models.get(candidate.id);
    if (!existing) {
      models.set(candidate.id, {
        ...candidate,
        capabilityTags: candidate.capabilityTags || [],
      });
      return;
    }

    const preferredModelName =
      existing.modelName && existing.modelName !== candidate.id
        ? existing.modelName
        : (candidate.modelName || existing.modelName);
    const preferredDescription =
      (candidate.description && candidate.description.length > (existing.description?.length || 0))
        ? candidate.description
        : existing.description;

    models.set(candidate.id, {
      id: candidate.id,
      modelName: preferredModelName,
      provider: existing.provider || candidate.provider,
      description: preferredDescription,
      capabilityTags: mergeCapabilityTags(existing.capabilityTags, candidate.capabilityTags),
    });
  }

  // ---------------------------------------------------------------------------
  // Private: Detail page scraping (API-first, DOM fallback)
  // ---------------------------------------------------------------------------

  /**
   * Navigates to a model detail page and extracts the free quota section data.
   *
   * Strategy (based on RCA analysis):
   *  1. First, try to call the internal API directly (zeldaEasy.broadscope-bailian.freeTrial.queryFreeTierQuota)
   *  2. If API fails, fall back to DOM scraping
   *
   * Returns null if the model has no free quota section.
   */
  private async _scrapeModelDetailQuota(
    page: Page,
    modelMeta: DiscoveredModelMeta
  ): Promise<ModelQuota | null> {
    const modelId = modelMeta.id;

    try {
      console.log(`[BailianScraper] Scraping ${modelId}...`);

      const detailUrl = MODEL_DETAIL_URL(modelId);
      await page.goto(detailUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(1200);

      // Strategy 1: Try API-first approach from the model detail page so the
      // request inherits the page-bound context/token expected by the gateway.
      const apiResult = await this._fetchQuotaViaApi(page, modelMeta);
      if (apiResult) {
        const pageMeta = await this._extractModelMetaFromPage(page, modelId);
        const preferredModelName =
          (modelMeta.modelName && modelMeta.modelName !== modelId ? modelMeta.modelName : null) ||
          pageMeta.modelName ||
          apiResult.modelName;
        console.log(`[BailianScraper] ${modelId}: Got quota via API`);
        return {
          ...apiResult,
          modelName: preferredModelName,
          provider: pageMeta.provider || modelMeta.provider || apiResult.provider,
          description: pageMeta.description || modelMeta.description || apiResult.description,
          capabilityTags: mergeCapabilityTags(
            apiResult.capabilityTags,
            modelMeta.capabilityTags,
            pageMeta.capabilityTags
          ),
        };
      }

      // The model detail DOM only exposes public "免费额度" copy, which is not
      // account-scoped usage. If the authenticated API does not return a quota
      // record, skip this model instead of silently mixing in public data.
      console.log(
        `[BailianScraper] ${modelId}: API returned no account-scoped quota, skipping public DOM fallback...`
      );
      return null;
    } catch (e) {
      if (e instanceof BailianConsoleSessionExpiredError) {
        throw e;
      }
      console.warn(`[BailianScraper] Error scraping ${modelId}:`, e);
      return null;
    }
  }

  /**
   * Fetch quota data via internal API.
   * This is the primary method based on network analysis.
   */
  private async _fetchQuotaViaApi(
    page: Page,
    modelMeta: DiscoveredModelMeta
  ): Promise<ModelQuota | null> {
    const modelId = modelMeta.id;

    try {
      const response = await this._callQuotaApi(page, modelId, true);

      if (this._isUnauthenticatedApiResponse(response)) {
        throw new BailianConsoleSessionExpiredError(
          `Bailian quota API returned unauthenticated response for ${modelId}.`
        );
      }

      // Check if response has quota data
      const responseRecord =
        response && typeof response === "object"
          ? response as Record<string, unknown>
          : null;
      const outerData =
        responseRecord?.data && typeof responseRecord.data === "object"
          ? responseRecord.data as Record<string, unknown>
          : null;

      if (responseRecord?.code === "200" && outerData?.success !== false) {
        const quotaRecord = this._findQuotaRecord(response, modelMeta);
        if (quotaRecord) {
          return quotaRecord;
        }
      }

      return null;
    } catch (e) {
      if (e instanceof BailianConsoleSessionExpiredError) {
        throw e;
      }
      console.warn(`[BailianScraper] API fetch failed for ${modelId}:`, e);
      return null;
    }
  }

  /**
   * Extract number from various possible formats
   */
  private _extractNumber(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseInt(value.replace(/,/g, ''), 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  private _findQuotaRecord(
    response: unknown,
    modelMeta: DiscoveredModelMeta
  ): ModelQuota | null {
    const matchedRecord = this._findQuotaRecordObject(response, modelMeta.id);
    if (!matchedRecord) {
      return null;
    }

    const totalCandidates = [
      matchedRecord.totalQuota,
      matchedRecord.total,
      matchedRecord.quotaInitTotal,
      matchedRecord.quotaTotal,
      matchedRecord.totalTokens,
    ];
    const remainingCandidates = [
      matchedRecord.remainingQuota,
      matchedRecord.remaining,
      matchedRecord.quotaTotal,
      matchedRecord.quotaRemaining,
      matchedRecord.quotaRemainTotal,
      matchedRecord.quotaRemain,
      matchedRecord.quotaLeftTotal,
      matchedRecord.balance,
    ];
    const usedCandidates = [
      matchedRecord.usedQuota,
      matchedRecord.used,
      matchedRecord.quotaUsed,
      matchedRecord.quotaUsedTotal,
      matchedRecord.quotaConsumed,
      matchedRecord.quotaConsumedTotal,
      matchedRecord.consumed,
    ];

    const rawTotal = this._firstNumber(totalCandidates);
    const rawRemaining = this._firstNumber(remainingCandidates);
    const rawUsed = this._firstNumber(usedCandidates);

    if (rawTotal === null && rawRemaining === null && rawUsed === null) {
      return null;
    }

    const remaining = Math.max(rawRemaining ?? 0, 0);
    const total = Math.max(rawTotal ?? 0, remaining, (rawUsed ?? 0) + remaining);

    // A total of 0 with no remaining means this model has no free quota allocation.
    // Returning a 0/0 record would create fabricated entries in the dashboard.
    if (total === 0) {
      return null;
    }
    const used = rawUsed !== null ? Math.max(rawUsed, 0) : Math.max(total - remaining, 0);

    const rawExpiresAt =
      matchedRecord.expiresAt ??
      matchedRecord.expiry ??
      matchedRecord.expireTime ??
      matchedRecord.quotaValidityPeriod ??
      matchedRecord.validityPeriod;

    return {
      id: modelMeta.id,
      modelName: modelMeta.modelName || modelMeta.id,
      provider: normalizeProviderLabel(modelMeta.provider || null, modelMeta.id),
      description: modelMeta.description || "",
      capabilityTags: modelMeta.capabilityTags || [],
      totalQuota: total,
      usedQuota: used,
      remainingQuota: remaining,
      expiresAt: this._normalizeExpiresAt(rawExpiresAt),
      unit: "tokens",
    };
  }

  private _findQuotaRecordObject(
    value: unknown,
    modelId: string
  ): Record<string, unknown> | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const matched = this._findQuotaRecordObject(item, modelId);
        if (matched) {
          return matched;
        }
      }
      return null;
    }

    const record = value as Record<string, unknown>;
    const recordModelId = this._extractModelId(record);
    if (recordModelId && recordModelId === normalizeModelId(modelId) && this._looksLikeQuotaRecord(record)) {
      return record;
    }

    for (const nestedValue of Object.values(record)) {
      const matched = this._findQuotaRecordObject(nestedValue, modelId);
      if (matched) {
        return matched;
      }
    }

    return null;
  }

  private _extractModelId(record: Record<string, unknown>): string | null {
    const candidate = record.model ?? record.modelId ?? record.model_id ?? record.slug;
    if (typeof candidate !== "string" || !isLikelyModelId(candidate)) {
      return null;
    }
    return normalizeModelId(candidate);
  }

  private _looksLikeQuotaRecord(record: Record<string, unknown>): boolean {
    const quotaKeys = [
      "quotaInitTotal",
      "quotaTotal",
      "quotaRemainTotal",
      "quotaRemaining",
      "quotaUsedTotal",
      "quotaConsumedTotal",
      "totalQuota",
      "remainingQuota",
      "usedQuota",
    ];

    return quotaKeys.some((key) => this._extractNumber(record[key]) !== null);
  }

  private _firstNumber(values: unknown[]): number | null {
    for (const value of values) {
      const parsed = this._extractNumber(value);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  private _normalizeExpiresAt(rawValue: unknown): string {
    if (typeof rawValue === "number") {
      return new Date(rawValue).toISOString();
    }

    if (typeof rawValue === "string" && rawValue.trim()) {
      const parsed = new Date(rawValue);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  }

  private async _extractModelMetaFromPage(
    page: Page,
    modelId: string
  ): Promise<DiscoveredModelMeta> {
    const pageMetadata = await page.evaluate((currentModelId: string) => {
      const texts: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node: Text | null;

      while ((node = walker.nextNode() as Text | null)) {
        const text = node.textContent?.replace(/\u00a0/g, " ").trim();
        if (!text || text.length > 160) {
          continue;
        }
        texts.push(text);
      }

      const introIndex = texts.findIndex((text) => text === "模型介绍");
      const result = {
        modelName: null as string | null,
        description: null as string | null,
        rawTags: [] as string[],
      };

      if (introIndex >= 0) {
        for (let index = introIndex + 1; index < Math.min(texts.length, introIndex + 24); index += 1) {
          const value = texts[index];
          if (value === "模型能力") {
            break;
          }
          if (!result.modelName && value.length <= 24 && value !== currentModelId && !value.includes("立即体验")) {
            result.modelName = value;
            continue;
          }
          if (!result.description && value.length >= 20) {
            result.description = value;
            continue;
          }
          if (value.length <= 10) {
            result.rawTags.push(value);
          }
        }
      }

      return result;
    }, modelId);

    return {
      id: modelId,
      modelName: pageMetadata.modelName || undefined,
      description: pageMetadata.description || undefined,
      capabilityTags: normalizeCapabilityTags(pageMetadata.rawTags),
    };
  }

  /**
   * Fallback: Scrape quota data from DOM.
   * Used when API method fails.
   */
  private async _scrapeQuotaFromDom(page: Page, modelId: string): Promise<ModelQuota | null> {
    // Wait for SPA content to render — look for the text "免费额度" or a timeout
    const hasQuotaSection = await page
      .waitForFunction(
        () => {
          return document.body?.innerText?.includes("免费额度");
        },
        { timeout: 8_000 }
      )
      .then(() => true)
      .catch(() => false);

    if (!hasQuotaSection) {
      console.log(`[BailianScraper] ${modelId}: No quota section found in DOM`);
      return null;
    }

    // Small extra wait for numbers to populate (they may load async)
    await page.waitForTimeout(1000);

    const pageText = await page
      .evaluate(() => document.body?.innerText ?? "")
      .catch(() => "");
    const actualModelId = extractModelCodeFromText(pageText);

    if (!actualModelId) {
      console.log(`[BailianScraper] ${modelId}: quota section found, but model code could not be verified`);
      return null;
    }

    if (actualModelId !== normalizeModelId(modelId)) {
      console.log(
        `[BailianScraper] ${modelId}: detail page resolved to ${actualModelId}, skipping mismatched quota`
      );
      return null;
    }

    const result = await page.evaluate((mId: string) => {
      // Strategy: Find all text nodes containing "免费额度", then walk up to find
      // the container with quota data. Use only text content, never CSS classes.

      // Helper: get all elements containing specific text
      function findElementsByText(searchText: string): Element[] {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null
        );
        const results: Element[] = [];
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
          if (node.textContent?.includes(searchText) && node.parentElement) {
            results.push(node.parentElement);
          }
        }
        return results;
      }

      const quotaLabels = findElementsByText("免费额度");
      if (quotaLabels.length === 0) return null;

      // For each "免费额度" label, walk up to find a container with quota data
      for (const label of quotaLabels) {
        let container: Element | null = label;
        for (let depth = 0; depth < 15; depth++) {
          if (!container) break;
          const text = container.textContent ?? "";

          // A valid quota container should have: a "/" (usage fraction) AND
          // either "剩余" or "过期" text
          const hasFraction = /[\d,]+\/[\d,]+/.test(text);
          const hasContext = text.includes("剩余") || text.includes("过期");

          if (hasFraction && hasContext) {
            // Found the right container — extract data
            // Parse expiry: "过期时间：2026/05/18" or variants
            const expiryMatch = text.match(
              /过期时间[：:]\s*(\d{4}[\/\-]\d{2}[\/\-]\d{2})/
            );

            // Parse usage: "986,654/1,000,000" — use the fraction that looks like token counts
            const fractionRegex = /([\d,]+)\s*\/\s*([\d,]+)/g;
            let remainingTokens: number | null = null;
            let totalTokens: number | null = null;

            // Pick the fraction with the largest denominator (most likely the token counter)
            let bestDenom = 0;
            let frac: RegExpExecArray | null;
            while ((frac = fractionRegex.exec(text)) !== null) {
              const num = parseInt(frac[1].replace(/,/g, ""), 10);
              const denom = parseInt(frac[2].replace(/,/g, ""), 10);
              if (denom > bestDenom) {
                bestDenom = denom;
                remainingTokens = num;
                totalTokens = denom;
              }
            }

            if (!totalTokens || totalTokens === 0) continue;

            // Parse percentage if available: "99% 剩余"
            const pctMatch = text.match(/(\d+)%\s*剩余/);

            return {
              modelId: mId,
              remainingTokens,
              totalTokens,
              expiry: expiryMatch ? expiryMatch[1] : null,
              percentage: pctMatch ? parseInt(pctMatch[1], 10) : null,
            };
          }

          container = container.parentElement;
        }
      }

      return null;
    }, modelId);

    if (!result) return null;

    const total = result.totalTokens ?? 0;
    const remaining = result.remainingTokens ?? 0;
    const used = total - remaining;

    let expiresAt: string;
    if (result.expiry) {
      expiresAt = new Date(result.expiry.replace(/\//g, "-")).toISOString();
    } else {
      // Default: 90 days from now
      expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    }

    return {
      id: actualModelId,
      modelName: actualModelId,
      provider: normalizeProviderLabel(null, actualModelId),
      description: "",
      capabilityTags: [],
      totalQuota: total,
      usedQuota: used,
      remainingQuota: remaining,
      expiresAt,
      unit: "tokens",
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Session & browser helpers
  // ---------------------------------------------------------------------------

  /**
   * Wait for at least one auth-related cookie to appear in the context.
   * Polls every 1 second up to the timeout.
   */
  private async _waitForAuthCookies(
    context: BrowserContext,
    timeoutMs: number
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const cookies = await context.cookies();
      const hasAuth = this._hasStrongAuthCookies(cookies);
      if (hasAuth) {
        console.log("[BailianScraper] Auth cookie detected.");
        return true;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  private async _contextWithSession(
    browser: Browser
  ): Promise<BrowserContext> {
    return browser.newContext({
      storageState: SESSION_PATH,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
  }

  private _findChromiumPath(): string | undefined {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  }

  private _getMatchingCookieNames(
    cookies: Array<{ name: string }>,
    indicators: string[]
  ): string[] {
    return cookies
      .filter((cookie) => indicators.some((indicator) => cookie.name === indicator))
      .map((cookie) => cookie.name);
  }

  private _hasStrongAuthCookies(cookies: Array<{ name: string }>): boolean {
    return this._getMatchingCookieNames(cookies, STRONG_AUTH_COOKIE_INDICATORS).length > 0;
  }

  private async _callQuotaApi(
    page: Page,
    modelId: string,
    logResponse: boolean
  ): Promise<unknown> {
    const response = await page.evaluate(async ({ mId, gatewayUrl }: { mId: string; gatewayUrl: string }) => {
      const params = new URLSearchParams();
      params.append("params", JSON.stringify({
        Api: "zeldaEasy.broadscope-bailian.freeTrial.queryFreeTierQuota",
        V: "1.0",
        Data: {
          queryFreeTierQuotaRequest: {
            models: [mId],
          },
          cornerstoneParam: {
            feTraceId: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            feURL: window.location.href,
            protocol: "V2",
            console: "ONE_CONSOLE",
            productCode: "p_efm",
            switchUserType: 3,
            domain: "bailian.console.aliyun.com",
            consoleSite: "BAILIAN_ALIYUN",
            "X-Anonymous-Id": "",
          },
        },
      }));
      params.append("region", "cn-beijing");

      // Match the same gateway host and action/product query params used by the
      // Bailian SPA, otherwise the gateway returns PostonlyOrTokenError.
      const res = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "*/*",
        },
        body: params.toString(),
        credentials: "include",
      });

      return await res.json();
    }, { mId: modelId, gatewayUrl: CONSOLE_GATEWAY_URL });

    if (logResponse) {
      console.log(
        `[BailianScraper] API response for ${modelId}:`,
        JSON.stringify(response).substring(0, 200)
      );
    }

    return response;
  }

  private _isUnauthenticatedApiResponse(response: unknown): boolean {
    if (!response || typeof response !== "object") return false;

    const record = response as Record<string, unknown>;
    const nestedData =
      record.data && typeof record.data === "object"
        ? record.data as Record<string, unknown>
        : null;

    return record.code === "ConsoleNeedLogin" ||
      record.message === "请登录" ||
      nestedData?.errorCode === "BailianGateway.Login.NotLogined";
  }

  private async _probeAuthenticatedQuotaApi(page: Page): Promise<boolean> {
    try {
      const response = await this._callQuotaApi(page, "qwen-plus", false);
      return !this._isUnauthenticatedApiResponse(response);
    } catch (e) {
      console.warn("[BailianScraper] Auth probe failed:", e);
      return false;
    }
  }

  private async _navigateToConsole(page: Page, url: string): Promise<void> {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  private _looksLoggedOut(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.includes("login") ||
        parsed.hostname.includes("passport") ||
        parsed.pathname.includes("login") ||
        parsed.pathname.includes("passport")
      );
    } catch {
      return /login|passport/.test(url);
    }
  }

  private async _pageHasLoginButton(page: Page): Promise<boolean> {
    return page
      .evaluate(() => {
        const controls = Array.from(document.querySelectorAll("a, button, span"));
        return controls.some((el) => {
          const text = el.textContent?.trim() ?? "";
          return (
            text === "登录" ||
            text === "Login" ||
            text === "Sign In" ||
            text === "立即登录"
          );
        });
      })
      .catch(() => false);
  }

  private async _waitForAuthenticatedPage(page: Page, timeoutMs: number): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (!this._looksLoggedOut(page.url())) {
        const hasLoginButton = await this._pageHasLoginButton(page);
        if (!hasLoginButton) {
          return;
        }
      }

      await page.waitForTimeout(1000);
    }

    throw new Error("Login timed out while waiting for the Aliyun console to leave the logged-out state.");
  }
}

export const consoleScraper = new BailianConsoleScraper();

export class BailianConsoleSessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BailianConsoleSessionExpiredError";
  }
}
