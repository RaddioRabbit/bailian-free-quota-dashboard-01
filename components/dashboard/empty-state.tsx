"use client";

import { Inbox } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4">
        <Inbox className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-lg font-medium">没有找到符合条件的模型</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        请尝试调整筛选条件或搜索关键词
      </p>
    </div>
  );
}
