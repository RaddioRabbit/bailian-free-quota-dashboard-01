"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ModelQuota } from "@/lib/data/types";
import { QuotaProgress } from "./quota-progress";
import { formatDateTime, daysUntilExpiry, percentUsed } from "@/lib/utils/format";
import { ExternalLink } from "lucide-react";

interface ModelCardListProps {
  models: ModelQuota[];
}

function getBorderColorClass(percentageUsed: number, days: number): string {
  if (days < 0 || percentageUsed >= 80) return "border-l-red-500";
  if (days <= 7 || percentageUsed >= 50) return "border-l-orange-500";
  return "border-l-green-500";
}

function getExpiryBadgeClass(days: number): string {
  if (days < 0) return "bg-red-100 text-red-700 hover:bg-red-100";
  if (days <= 7) return "bg-orange-100 text-orange-700 hover:bg-orange-100";
  return "bg-green-100 text-green-700 hover:bg-green-100";
}

function getExpiryText(days: number): string {
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今日到期";
  return `剩余 ${days} 天`;
}

export function ModelCardList({ models }: ModelCardListProps) {
  return (
    <div className="flex flex-col gap-3">
      {models.map((m) => {
        const days = daysUntilExpiry(m.expiresAt);
        const pUsed = percentUsed(m.totalQuota, m.usedQuota);
        const borderClass = getBorderColorClass(pUsed, days);
        return (
          <Card
            key={m.id}
            className={`overflow-hidden border-l-4 ${borderClass}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{m.modelName}</div>
                  <div className="text-xs text-muted-foreground">{m.provider}</div>
                  {m.capabilityTags && m.capabilityTags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.capabilityTags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[11px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <a
                  href={`https://bailian.console.aliyun.com/cn-beijing#/model-market/detail/${encodeURIComponent(m.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-muted hover:text-foreground"
                >
                  查看
                  <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </div>

              <div className="mt-3">
                <div className="mb-1 text-sm text-muted-foreground">剩余额度</div>
                <QuotaProgress
                  total={m.totalQuota}
                  used={m.usedQuota}
                  remaining={m.remainingQuota}
                />
              </div>

              <div className="mt-3 flex items-center gap-2">
                <span className="tabular-nums text-sm">
                  {formatDateTime(m.expiresAt)}
                </span>
                <Badge
                  variant="secondary"
                  className={`text-xs ${getExpiryBadgeClass(days)}`}
                >
                  {getExpiryText(days)}
                </Badge>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
