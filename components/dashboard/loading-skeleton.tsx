"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function LoadingSkeleton() {
  return (
    <div className="rounded-md border">
      <div className="grid grid-cols-4 gap-4 border-b p-4">
        <Skeleton className="h-4 w-[120px]" />
        <Skeleton className="h-4 w-[100px]" />
        <Skeleton className="h-4 w-[120px]" />
        <Skeleton className="h-4 w-[60px] justify-self-end" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="grid grid-cols-4 items-center gap-4 p-4">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-4 w-[140px]" />
            <Skeleton className="h-3 w-[80px]" />
          </div>
          <Skeleton className="h-6 w-[160px]" />
          <div className="flex flex-col gap-1">
            <Skeleton className="h-4 w-[140px]" />
            <Skeleton className="h-5 w-[64px] rounded-full" />
          </div>
          <Skeleton className="h-8 w-[60px] justify-self-end rounded-md" />
        </div>
      ))}
    </div>
  );
}
