"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SourceScopeSummaryProps {
  sourceUrlCount?: number;
  sourceUrlsPreview?: string[];
}

export function SourceScopeSummary({
  sourceUrlCount = 0,
  sourceUrlsPreview = [],
}: SourceScopeSummaryProps) {
  if (!sourceUrlCount) {
    return null;
  }

  return (
    <div className="mb-4 rounded-xl border bg-muted/20 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium">当前抓取页面（{sourceUrlCount}）</div>
          <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
            {sourceUrlsPreview.map((sourceUrl) => (
              <span key={sourceUrl} className="truncate">
                {sourceUrl}
              </span>
            ))}
            {sourceUrlCount > sourceUrlsPreview.length && (
              <span>还有 {sourceUrlCount - sourceUrlsPreview.length} 个页面未展开</span>
            )}
          </div>
        </div>
        <Link
          href="/source-config"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          编辑配置
        </Link>
      </div>
    </div>
  );
}
