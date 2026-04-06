/**
 * Format a number with commas as thousands separators.
 */
export function formatNumber(n: number): string {
  return n.toLocaleString("zh-CN");
}

/**
 * Format an ISO date string to a readable local string.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Compute days remaining until expiration.
 * Positive = still valid, 0 = expires today, negative = already expired.
 */
export function daysUntilExpiry(iso: string): number {
  const now = new Date();
  const expiry = new Date(iso);
  const msPerDay = 24 * 60 * 60 * 1000;
  // Floor to whole days
  const diff = expiry.getTime() - now.getTime();
  return Math.floor(diff / msPerDay);
}

/**
 * Compute percentage used.
 */
export function percentUsed(total: number, used: number): number {
  if (total <= 0) return 0;
  const p = (used / total) * 100;
  return Math.min(100, Math.max(0, p));
}
