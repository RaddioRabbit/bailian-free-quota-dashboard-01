"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { DashboardData, FilterTab, SortBy } from "@/lib/data/types";
import { DashboardHeader } from "./header";
import { Toolbar } from "./toolbar";
import { ModelTable } from "./model-table";
import { ModelCardList } from "./model-card-list";
import { LoadingSkeleton } from "./loading-skeleton";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { SourceScopeSummary } from "./source-scope-summary";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { daysUntilExpiry, percentUsed } from "@/lib/utils/format";

/**
 * Dashboard data flow:
 *
 * +------------+         +----------------+         +------------------+
 * |  Client    |  fetch  |  /api/models   |  call   |  lib/data/api    |
 * |  Component | <------ |  Route Handler | <------ |  (mock/real)     |
 * +------------+         +----------------+         +------------------+
 *
 * Filter / Sort / Search handled client-side in useMemo.
 */

function matchesSearch(model: DashboardData["models"][number], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    model.modelName.toLowerCase().includes(q) ||
    model.provider.toLowerCase().includes(q) ||
    (model.description ?? "").toLowerCase().includes(q) ||
    model.capabilityTags?.some((tag) => tag.toLowerCase().includes(q)) === true
  );
}

function matchesFilter(model: DashboardData["models"][number], filter: FilterTab): boolean {
  switch (filter) {
    case "all":
      return true;
    case "expiring_soon": {
      const days = daysUntilExpiry(model.expiresAt);
      return days <= 10 && days >= 0;
    }
    case "low_quota": {
      const pUsed = percentUsed(model.totalQuota, model.usedQuota);
      return pUsed >= 70;
    }
    default:
      return true;
  }
}

function sortModels(
  models: DashboardData["models"],
  sortBy: SortBy
): DashboardData["models"] {
  const list = [...models];
  switch (sortBy) {
    case "name_asc":
      list.sort((a, b) => a.modelName.localeCompare(b.modelName, "zh-CN"));
      break;
    case "name_desc":
      list.sort((a, b) => b.modelName.localeCompare(a.modelName, "zh-CN"));
      break;
    case "expiry_asc":
      list.sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
      break;
    case "expiry_desc":
      list.sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime());
      break;
    case "remaining_desc":
      list.sort((a, b) => b.remainingQuota - a.remainingQuota);
      break;
    case "remaining_asc":
      list.sort((a, b) => a.remainingQuota - b.remainingQuota);
      break;
    default:
      break;
  }
  return list;
}

interface AuthState {
  checked: boolean;
  loggedIn: boolean;
  reason: string | null;
  mode?: "trigger" | "direct";
}

function normalizeRuntimeMode(mode: unknown): AuthState["mode"] {
  if (mode === "trigger" || mode === "docker") return "trigger";
  if (mode === "direct") return "direct";
  return undefined;
}

export function DashboardContent() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>({
    checked: false,
    loggedIn: false,
    reason: null,
    mode: undefined,
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [sortBy, setSortBy] = useState<SortBy>("expiry_asc");
  const loginPollTimerRef = useRef<number | null>(null);
  const loginPollAttemptsRef = useRef(0);
  const dataResolvedRef = useRef(false);
  const errorRef = useRef<string | null>(null);
  const refreshInProgressRef = useRef(false);

  // Debounce search input by 200ms
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(id);
  }, [search]);

  const fetchData = useCallback(async (silent = false, notifyOnSuccess = true) => {
    // 如果全量刷新正在进行，跳过 silent 的 /api/models 调用，避免覆盖 fetching 状态
    if (silent && refreshInProgressRef.current) {
      return;
    }
    if (!silent) setIsLoading(true);
    if (silent) setIsRefreshing(true);
    setError(null);
    errorRef.current = null;
    try {
      const res = await fetch("/api/models");
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      const payload: DashboardData = await res.json();
      dataResolvedRef.current = true;
      setData(payload);
      if (silent && notifyOnSuccess) {
        toast.success("数据已更新");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "加载失败";
      errorRef.current = msg;
      if (!dataResolvedRef.current) {
        setError(msg);
      }
      if (silent) {
        toast.error(`刷新失败: ${msg}`);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const fetchAuthStatus = useCallback(async (): Promise<{ loggedIn: boolean; reason?: string | null; mode?: string } | null> => {
    try {
      const res = await fetch("/api/auth");
      const payload = await res.json();
      setAuthState({
        checked: true,
        loggedIn: Boolean(payload.loggedIn),
        reason: payload.reason ?? null,
        mode: normalizeRuntimeMode(payload.mode),
      });
      return payload;
    } catch {
      setAuthState({
        checked: true,
        loggedIn: false,
        reason: "error",
        mode: undefined,
      });
      return null;
    }
  }, []);

  const stopLoginPolling = useCallback(() => {
    if (loginPollTimerRef.current !== null) {
      window.clearTimeout(loginPollTimerRef.current);
      loginPollTimerRef.current = null;
    }
    loginPollAttemptsRef.current = 0;
  }, []);

  const refreshDashboard = useCallback(async () => {
    refreshInProgressRef.current = true;
    setIsRefreshing(true);
    const toastId = toast.loading("正在抓取最新额度数据，预计 2-3 分钟，请不要关闭页面…");
    try {
      const res = await fetch("/api/fetch-data", { method: "POST" });
      const payload = await res.json().catch(() => ({} as Record<string, unknown>));

      if (!res.ok) {
        const errorMsg = (payload.error as string) || `HTTP ${res.status}`;
        toast.error(`抓取失败：${errorMsg}`, { id: toastId });
      } else {
        const count = (payload.count as number) ?? 0;
        const elapsed = ((payload.elapsedMs as number) ?? 0) / 1000;
        toast.success(
          `已更新 ${count} 个模型，耗时 ${elapsed.toFixed(1)} 秒`,
          { id: toastId }
        );

        // 直接用 /api/fetch-data 返回的数据更新 state，避免 Docker 文件系统延迟导致读到旧数据
        const models = payload.models as DashboardData["models"] | undefined;
        console.log("[Dashboard] refreshDashboard 收到数据:", {
          count,
          modelsLength: Array.isArray(models) ? models.length : 0,
          updatedAt: payload.updatedAt,
          sourceUrlCount: payload.sourceUrlCount,
        });
        setData((prev) => ({
          ...prev,
          models: Array.isArray(models) ? models : prev?.models ?? [],
          updatedAt: (payload.updatedAt as string) || new Date().toISOString(),
          sourceUrlCount:
            (payload.sourceUrlCount as number) ?? prev?.sourceUrlCount,
          sourceUrlsPreview:
            (payload.sourceUrlsPreview as string[]) ?? prev?.sourceUrlsPreview,
          _note: undefined,
          fetchStatusText: undefined,
        }));
        dataResolvedRef.current = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络错误";
      toast.error(`刷新失败：${msg}`, { id: toastId });
    } finally {
      refreshInProgressRef.current = false;
    }

    await fetchAuthStatus();
    setIsRefreshing(false);
  }, [fetchAuthStatus]);

  const startLoginPolling = useCallback(() => {
    stopLoginPolling();

    const poll = async () => {
      const auth = await fetchAuthStatus();
      if (auth?.loggedIn) {
        stopLoginPolling();
        toast.success("已检测到阿里云登录");
        if ((data?.sourceUrlCount || 0) === 0) {
          toast.info("请先配置要抓取的模型广场页面");
          window.location.href = "/source-config";
          return;
        }
        toast.info("正在拉取数据");
        await fetchData(true, false);
        return;
      }

      loginPollAttemptsRef.current += 1;
      if (loginPollAttemptsRef.current >= 60) {
        stopLoginPolling();
        toast.error("登录状态仍未建立，请确认弹出浏览器中的阿里云认证已完成");
        return;
      }

      loginPollTimerRef.current = window.setTimeout(poll, 3000);
    };

    void poll();
  }, [data?.sourceUrlCount, fetchAuthStatus, fetchData, stopLoginPolling]);

  useEffect(() => {
    void fetchData();
    void fetchAuthStatus();

    return () => {
      stopLoginPolling();
    };
  }, [fetchAuthStatus, fetchData, stopLoginPolling]);

  // 检测 ?refresh=1 query：用户在 /source-config 保存配置后跳转回来，触发与点击「刷新」等价的抓取流程
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("refresh") !== "1") return;
    // 清掉 query 参数，避免用户手动刷新页面时重复触发
    window.history.replaceState(null, "", "/");
    // 用 ref 取最新函数引用，避免 stale closure，也不需要 persistent flag
    void refreshDashboardRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 把 refreshDashboard 最新引用存到 ref，供上面 effect 使用
  const refreshDashboardRef = useRef(refreshDashboard);
  refreshDashboardRef.current = refreshDashboard;


  // Auto refresh every 5 minutes (silent)
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchAuthStatus();
      void fetchData(true, false);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAuthStatus, fetchData]);

  useEffect(() => {
    if (!authState.loggedIn || data?._note !== "fetching") {
      return;
    }

    const interval = setInterval(() => {
      void fetchData(true, false);
    }, 10000);

    return () => clearInterval(interval);
  }, [authState.loggedIn, data?._note, fetchData]);

  const filteredModels = useMemo(() => {
    if (!data) return [];
    let list = data.models.filter((m) => matchesSearch(m, debouncedSearch));
    list = list.filter((m) => matchesFilter(m, filter));
    list = sortModels(list, sortBy);
    return list;
  }, [data, debouncedSearch, filter, sortBy]);

  const isFetchingRealData =
    authState.loggedIn && data?._note === "fetching";

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader
        updatedAt={data?.updatedAt}
        isRefreshing={isRefreshing}
        onRefresh={() => void refreshDashboard()}
        isFetchingRealData={isFetchingRealData}
        fetchStatusText={data?.fetchStatusText}
        isLoggedIn={authState.loggedIn}
        authChecked={authState.checked}
        mode={authState.mode}
        onLoginStarted={startLoginPolling}
        onLoggedOut={async () => {
          stopLoginPolling();
          await fetchAuthStatus();
          await fetchData(true, false);
        }}
      />
      <Toolbar
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        sortBy={sortBy}
        onSortChange={setSortBy}
      />
      <main className="px-4 pb-12 sm:px-6 lg:px-8">
        <SourceScopeSummary
          sourceUrlCount={data?.sourceUrlCount}
          sourceUrlsPreview={data?.sourceUrlsPreview}
        />
        {isLoading && !data && <LoadingSkeleton />}
        {!isLoading && error && (
          <ErrorState message={error} onRetry={() => fetchData()} />
        )}
        {!isLoading && !error && data && (
          <>
            {/* Not logged in — no data to show */}
            {data.models.length === 0 && !authState.loggedIn && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="rounded-full bg-muted p-5">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium">尚未登录</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  点击右上角「登录阿里云账号」，完成认证后即可查看真实额度数据
                </p>
              </div>
            )}
            {data.models.length === 0 && authState.loggedIn && data._note === "no_sources" && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="rounded-full bg-muted p-5">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7h16M4 12h16M4 17h10" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium">请先配置抓取页面</h3>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  登录已完成，但还没有填写要抓取的阿里云百炼模型广场页面。先去配置页面粘贴 URL，再回来查看模型额度。
                </p>
                <Link
                  href="/source-config"
                  className={cn(buttonVariants({ variant: "default" }), "mt-4")}
                >
                  去配置抓取页面
                </Link>
              </div>
            )}
            {/* Logged in but real data still loading in background */}
            {data.models.length === 0 && authState.loggedIn && data._note === "fetching" && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="rounded-full bg-muted p-5">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium">正在拉取数据</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  正在根据你配置的模型广场页面抓取数据，请稍候…
                </p>
              </div>
            )}
            {data.models.length === 0 && authState.loggedIn && !data._note && (
              <EmptyState />
            )}
            {/* Has data */}
            {data.models.length > 0 && (
              <>
                {filteredModels.length === 0 ? (
                  <EmptyState />
                ) : (
                  <>
                    <div className="hidden md:block">
                      <ModelTable models={filteredModels} />
                    </div>
                    <div className="md:hidden">
                      <ModelCardList models={filteredModels} />
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
