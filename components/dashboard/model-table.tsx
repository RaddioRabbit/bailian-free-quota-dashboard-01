"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ModelQuota } from "@/lib/data/types";
import { QuotaProgress } from "./quota-progress";
import { formatDateTime, daysUntilExpiry } from "@/lib/utils/format";
import { ExternalLink } from "lucide-react";

interface ModelTableProps {
  models: ModelQuota[];
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

export function ModelTable({ models }: ModelTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[240px]">模型</TableHead>
            <TableHead className="w-[200px]">剩余额度</TableHead>
            <TableHead className="w-[200px]">过期时间</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((m) => {
            const days = daysUntilExpiry(m.expiresAt);
            return (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{m.modelName}</span>
                    <span className="text-xs text-muted-foreground">{m.provider}</span>
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
                </TableCell>
                <TableCell>
                  <QuotaProgress
                    total={m.totalQuota}
                    used={m.usedQuota}
                    remaining={m.remainingQuota}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className="tabular-nums text-sm">
                      {formatDateTime(m.expiresAt)}
                    </span>
                    <Badge
                      variant="secondary"
                      className={`w-fit text-xs ${getExpiryBadgeClass(days)}`}
                    >
                      {getExpiryText(days)}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <a
                    href={`https://bailian.console.aliyun.com/cn-beijing#/model-market/detail/${encodeURIComponent(m.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-muted hover:text-foreground"
                  >
                    查看
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
