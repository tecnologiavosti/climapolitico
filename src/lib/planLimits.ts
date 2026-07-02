export const UNLIMITED_TIERS = ["vip", "vitalicio", "vitalício", "lifetime"] as const;

export function isUnlimitedTier(tier?: string | null): boolean {
  const t = String(tier ?? "").toLowerCase().trim();
  return (UNLIMITED_TIERS as readonly string[]).includes(t);
}

export function isUnlimitedSubscription(
  sub?: {
    tier?: string | null;
    plan?: string | null;
    name?: string | null;
    display_name?: string | null;
    max_candidates?: number | null;
    max_updates_per_month?: number | null;
  } | null,
): boolean {
  if (!sub) return false;
  const candidates = [sub.tier, sub.plan, sub.name, sub.display_name];
  return candidates.some(isUnlimitedTier);
}

export function formatPlanLabel(tier?: string | null): string {
  const normalized = String(tier ?? "").toLowerCase().trim();
  if (normalized === "vip") return "Plano VIP";
  if (normalized === "lifetime" || normalized === "vitalicio" || normalized === "vitalício") return "Plano Vitalício";
  if (!normalized) return "Plano";
  return `Plano ${normalized.charAt(0).toUpperCase() + normalized.slice(1)}`;
}
