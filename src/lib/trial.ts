export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const keyFor = (userId: string) => `trial_start:${userId}`;

export function getTrialStart(userId: string): number | null {
  const v = localStorage.getItem(keyFor(userId));
  return v ? parseInt(v, 10) : null;
}

export function startTrial(userId: string): number {
  const now = Date.now();
  localStorage.setItem(keyFor(userId), now.toString());
  return now;
}

export function getDaysLeft(userId: string): number | null {
  const start = getTrialStart(userId);
  if (!start) return null;
  const remaining = TRIAL_DURATION_MS - (Date.now() - start);
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / 86400000);
}
