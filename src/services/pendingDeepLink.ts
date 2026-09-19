/**
 * Holds the destination a deep link asked for while the app was signed out.
 *
 * A shared post link is usually the first thing someone ever sees of Matchr,
 * so it routinely opens with no session. AuthGuard sends them to sign-in;
 * without this, sign-in drops them on the home feed and the post they were
 * actually sent is gone. Parking the path here lets the guard finish the
 * journey once they are signed in and onboarded.
 *
 * In memory on purpose: it is valid only for the launch it arrived on. A path
 * persisted to storage would reopen weeks later out of nowhere.
 */
let pending: string | null = null;

// Only app-internal paths are ever honored, so a crafted link cannot aim the
// post-login redirect at an arbitrary target.
const SAFE_PATH = /^\/[A-Za-z0-9\-._~/]*$/;

export function setPendingDeepLink(path: string | null) {
  pending = path && SAFE_PATH.test(path) && !path.startsWith('//') ? path : null;
}

/** Returns the parked path and clears it, so it is only ever used once. */
export function takePendingDeepLink(): string | null {
  const path = pending;
  pending = null;
  return path;
}

export function hasPendingDeepLink() {
  return pending !== null;
}
