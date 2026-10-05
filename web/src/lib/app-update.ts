// New versions of the app shell that the service worker keeps (registered in main.tsx). A new version is
// downloaded in the background and used once the person agrees, so nothing changes under them while they type.

let update: (() => void) | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

/** A new version is ready; `apply` switches to it and reloads the page. */
export function announceUpdate(apply: () => void): void {
  update = apply;
  notify();
}

/** The person asked for the new version. */
export function applyUpdate(): void {
  const apply = update;
  update = null;
  notify();
  apply?.();
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a new version is waiting. */
export const hasUpdate = (): boolean => update !== null;

/**
 * The server says this page is too old (426): forget the kept copy, so the next load comes from the server
 * and a reload cannot bring the same old page back.
 */
export async function dropAppShell(
  container: ServiceWorkerContainer | undefined = globalThis.navigator?.serviceWorker
): Promise<void> {
  try {
    const registrations = (await container?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // No service worker here (or no access to it): the page already comes from the server.
  }
}
