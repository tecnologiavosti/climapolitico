// Push notification scaffolding.
// Structure ready for future backend integration (VAPID + subscription persistence).
// Trigger types the app expects to send once wired end-to-end:
//   - "candidate.growth"      -> crescimento de candidato
//   - "candidate.sentiment"   -> mudança de sentimento
//   - "candidate.viral"       -> alerta viral

export type PushTriggerType =
  | "candidate.growth"
  | "candidate.sentiment"
  | "candidate.viral";

export interface PushPayload {
  type: PushTriggerType;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) return "denied";
  return Notification.requestPermission();
}

// Placeholder — real subscription requires VAPID key + backend endpoint.
export async function subscribeToPush(_vapidPublicKey?: string): Promise<PushSubscription | null> {
  if (!isPushSupported() || !_vapidPublicKey) return null;
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: _vapidPublicKey,
  });
}
