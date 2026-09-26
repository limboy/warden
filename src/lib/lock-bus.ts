// Lets code outside the editor (e.g. an OS "open file" request) ask the open
// vault to save and lock. A no-op when no vault is open.

const EVENT = "warden:request-lock";

export function requestLock() {
  window.dispatchEvent(new Event(EVENT));
}

export function onLockRequest(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
