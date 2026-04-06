"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { RefreshCw, LogIn, LogOut, Loader2, SlidersHorizontal } from "lucide-react";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface HeaderProps {
  updatedAt?: string;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  isFetchingRealData?: boolean;
  fetchStatusText?: string;
  isLoggedIn?: boolean;
  authChecked?: boolean;
  onLoginStarted?: () => void;
}

export function DashboardHeader({
  updatedAt,
  isRefreshing,
  onRefresh,
  isFetchingRealData = false,
  fetchStatusText = "正在拉取数据",
  isLoggedIn = false,
  authChecked = false,
  onLoginStarted,
}: HeaderProps) {
  const [authLoading, setAuthLoading] = useState(false);
  const showLogout = authChecked && isLoggedIn;

  async function handleLogin() {
    setAuthLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login" }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        toast.error(data.message || "启动登录失败，请查看控制台日志");
      } else {
        toast.info(data.message || "浏览器已打开，请在弹出的窗口中完成登录，然后点击刷新。", {
          duration: 10000,
        });
        onLoginStarted?.();
      }
    } catch {
      toast.error("启动登录流程失败");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    setAuthLoading(true);
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      toast.success("已退出登录");
      onRefresh?.();
    } catch {
      toast.error("退出登录失败");
    } finally {
      setAuthLoading(false);
    }
  }

  return (
    <header className="flex flex-col gap-4 border-b bg-background px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">阿里云百炼模型广场</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          免费额度查看面板
          {authChecked && (
            <span
              className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                isLoggedIn
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {isLoggedIn ? "已登录" : "未登录"}
            </span>
          )}
          {isFetchingRealData && (
            <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              {fetchStatusText}
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {updatedAt && (
          <span className="text-sm text-muted-foreground tabular-nums">
            更新于 {formatDateTime(updatedAt)}
          </span>
        )}
        {showLogout ? (
          <>
            <Link
              href="/source-config"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              抓取配置
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={authLoading}
            >
              {authLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="mr-2 h-4 w-4" />
              )}
              退出登录
            </Button>
          </>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={handleLogin}
            disabled={authLoading}
          >
            {authLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogIn className="mr-2 h-4 w-4" />
            )}
            登录阿里云账号
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>
    </header>
  );
}
