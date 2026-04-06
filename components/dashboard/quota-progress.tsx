"use client";

import { percentUsed } from "@/lib/utils/format";

interface QuotaProgressProps {
  total: number;
  used: number;
  remaining: number;
}

function getProgressColorClass(percentageUsed: number): string {
  if (percentageUsed >= 80) return "bg-red-500";
  if (percentageUsed >= 50) return "bg-orange-500";
  return "bg-green-500";
}

function getTextColorClass(percentageUsed: number): string {
  if (percentageUsed >= 80) return "text-red-600";
  if (percentageUsed >= 50) return "text-orange-600";
  return "text-green-600";
}

export function QuotaProgress({ total, used, remaining }: QuotaProgressProps) {
  const pUsed = percentUsed(total, used);
  const pRemaining = Math.max(0, 100 - pUsed);
  const colorClass = getProgressColorClass(pUsed);
  const textClass = getTextColorClass(pUsed);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-sm">
        <span className="tabular-nums text-muted-foreground">{remaining.toLocaleString("zh-CN")}</span>
        <span className={`tabular-nums font-medium ${textClass}`}>{pRemaining.toFixed(1)}%</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${colorClass} transition-all`}
          style={{ width: `${pRemaining}%` }}
          aria-label={`剩余额度 ${pRemaining.toFixed(1)}%`}
          role="progressbar"
        />
      </div>
    </div>
  );
}
