export const UNLIMITED_TIERS = ["vip", "vitalicio", "lifetime"] as const;

export function isUnlimitedTier(tier?: string | null): boolean {
  const t = String(tier ?? "").toLowerCase().trim();
  return (UNLIMITED_TIERS as readonly string[]).includes(t);
}

export function isUnlimitedSubscription(sub?: { tier?: string | null } | null): boolean {
  return isUnlimitedTier(sub?.tier);
}
