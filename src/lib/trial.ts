export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const keyFor = (userId: string) => `trial_start:${userId}`;
const celebrationKeyFor = (userId: string) => `trial_celebration_pending:${userId}`;
const MACHINE_TRIAL_KEY = "trial_machine_claimed_at";
const LEGACY_TRIAL_KEY = "trial_start";
const PENDING_TRIAL_KEY = "trial_activation_pending";

const storage = () => (typeof window === "undefined" ? null : window.localStorage);

export function getTrialStart(userId: string): number | null {
  const v = storage()?.getItem(keyFor(userId));
  return v ? parseInt(v, 10) : null;
}

export function hasMachineTrialStarted(): boolean {
  const store = storage();
  if (!store?.length) return false;
  if (store.getItem(MACHINE_TRIAL_KEY) || store.getItem(LEGACY_TRIAL_KEY)) return true;
  for (let i = 0; i < store.length; i += 1) {
    if (store.key(i)?.startsWith("trial_start:")) return true;
  }
  return false;
}

export function startTrial(userId: string): number | null {
  const existing = getTrialStart(userId);
  if (existing) {
    storage()?.setItem(MACHINE_TRIAL_KEY, existing.toString());
    return existing;
  }

  if (hasMachineTrialStarted()) return null;

  const now = Date.now();
  const store = storage();
  store?.setItem(keyFor(userId), now.toString());
  store?.setItem(MACHINE_TRIAL_KEY, now.toString());
  return now;
}

export function getDaysLeft(userId: string): number | null {
  const start = getTrialStart(userId);
  if (!start) return null;
  const remaining = TRIAL_DURATION_MS - (Date.now() - start);
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / 86400000);
}

export function requestTrialAfterLogin() {
  storage()?.setItem(PENDING_TRIAL_KEY, "true");
}

export function consumeTrialAfterLogin(): boolean {
  const store = storage();
  const pending = store?.getItem(PENDING_TRIAL_KEY) === "true";
  if (pending) store?.removeItem(PENDING_TRIAL_KEY);
  return pending;
}

export function queueTrialCelebration(userId: string) {
  storage()?.setItem(celebrationKeyFor(userId), "true");
}

export function shouldShowTrialCelebration(userId: string): boolean {
  return storage()?.getItem(celebrationKeyFor(userId)) === "true";
}

export function clearTrialCelebration(userId: string) {
  storage()?.removeItem(celebrationKeyFor(userId));
}
