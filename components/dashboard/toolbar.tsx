"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FilterTab, SortBy } from "@/lib/data/types";
import { Search } from "lucide-react";

const SORT_LABELS: Record<SortBy, string> = {
  name_asc: "名称：A 到 Z",
  name_desc: "名称：Z 到 A",
  expiry_asc: "过期时间：先到期",
  expiry_desc: "过期时间：后到期",
  remaining_desc: "剩余额度：从多到少",
  remaining_asc: "剩余额度：从少到多",
};

const SORT_OPTIONS: Array<{ value: SortBy; label: string }> = [
  { value: "name_asc", label: SORT_LABELS.name_asc },
  { value: "name_desc", label: SORT_LABELS.name_desc },
  { value: "expiry_asc", label: SORT_LABELS.expiry_asc },
  { value: "expiry_desc", label: SORT_LABELS.expiry_desc },
  { value: "remaining_desc", label: SORT_LABELS.remaining_desc },
  { value: "remaining_asc", label: SORT_LABELS.remaining_asc },
];

interface ToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filter: FilterTab;
  onFilterChange: (value: FilterTab) => void;
  sortBy: SortBy;
  onSortChange: (value: SortBy) => void;
}

export function Toolbar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  sortBy,
  onSortChange,
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
      <div className="relative w-full sm:max-w-xs">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="搜索模型名称..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <ToggleGroup
          value={filter ? [filter] : []}
          onValueChange={(v) => {
            const first = (v as string[])[0];
            if (first) onFilterChange(first as FilterTab);
          }}
          className="flex-wrap justify-start"
        >
          <ToggleGroupItem value="all" aria-label="全部">
            全部
          </ToggleGroupItem>
          <ToggleGroupItem value="expiring_soon" aria-label="即将过期">
            即将过期
          </ToggleGroupItem>
          <ToggleGroupItem value="low_quota" aria-label="额度紧张">
            额度紧张
          </ToggleGroupItem>
        </ToggleGroup>

        <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortBy)}>
          <SelectTrigger className="w-[180px]">
            <span className="flex-1 truncate text-left">{SORT_LABELS[sortBy]}</span>
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
