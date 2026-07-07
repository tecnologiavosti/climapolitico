// Guarded service worker cleanup wrapper.
// Auth must never be served from a stale PWA bundle: older cached builds used
// the native recovery email flow, which sends the default System-Blueprint email.
async function unregisterMatching() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));

    if ("caches" in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
  } catch {
    /* noop */
  }
}

export async function registerSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  await unregisterMatching();
}
