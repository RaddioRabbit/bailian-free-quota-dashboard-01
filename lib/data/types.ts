/**
 * Data layer types for the Bailian Model Quota Dashboard.
 * This file defines the shape of model quota data from the API,
 * making it easy to swap mock data for a real API later.
 */

export interface ModelQuota {
  id: string;
  modelName: string;
  provider: string;
  description?: string;
  capabilityTags?: string[];
  totalQuota: number;
  usedQuota: number;
  remainingQuota: number;
  // ISO 8601 date string for expiration
  expiresAt: string;
  // unit for quota, e.g. "tokens", "requests", "credits"
  unit: string;
}

export interface DashboardData {
  models: ModelQuota[];
  updatedAt: string;
  _note?: "fetching" | "no_sources";
  fetchStatusText?: string;
  sourceUrlCount?: number;
  sourceUrlsPreview?: string[];
}

export type FilterTab = "all" | "expiring_soon" | "low_quota";

export type SortBy = "name_asc" | "name_desc" | "expiry_asc" | "expiry_desc" | "remaining_desc" | "remaining_asc";
