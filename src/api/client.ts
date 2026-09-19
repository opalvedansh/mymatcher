import { supabase } from '../supabase';
import Constants from 'expo-constants';

// ─── Network-agnostic API URL ──────────────────────────────────────
// Defaults to the deployed production API so the app works from any
// network (WiFi, cellular, hotel, VPN...) without extra setup.
// To point at a local backend during development, set
// EXPO_PUBLIC_API_URL in .env (e.g. to your Mac's LAN IP) — or set
// EXPO_PUBLIC_USE_LOCAL_API=1 to auto-detect the Metro bundler's host.
function getBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    let url = process.env.EXPO_PUBLIC_API_URL;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    return url;
  }

  if (__DEV__ && process.env.EXPO_PUBLIC_USE_LOCAL_API) {
    const debuggerHost = Constants.expoConfig?.hostUri ?? Constants.manifest2?.extra?.expoGo?.debuggerHost;
    const host = debuggerHost?.split(':')[0] ?? 'localhost';
    return `http://${host}:3000`;
  }

  return 'https://api.mymatchr.in';
}

const BASE_URL = getBaseUrl();

// ─── Error shape ──────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Token helper ─────────────────────────────────────────────────
// supabase.auth.getSession() reads AsyncStorage every call — a native bridge
// round-trip on the critical path of all ~55 api.* call sites. The session is
// held in memory instead and refreshed from onAuthStateChange, which fires for
// SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED / USER_UPDATED. Storage is only read
// on a cold start, or when the cached token is at/near expiry so that supabase
// can rotate it.
type CachedSession = { token: string; expiresAt: number } | null;

let cachedSession: CachedSession;
let sessionHydrated = false;
let hydrating: Promise<void> | null = null;

// Refresh a little before the real deadline so a request never leaves with a
// token that expires in flight.
const EXPIRY_SKEW_MS = 60_000;

function adoptSession(session: { access_token?: string; expires_at?: number } | null) {
  cachedSession = session?.access_token
    ? {
        token: session.access_token,
        // expires_at is in seconds since epoch; absent means "no known expiry",
        // which is treated as already stale so the next read revalidates.
        expiresAt: session.expires_at ? session.expires_at * 1000 : 0,
      }
    : null;
  sessionHydrated = true;
}

supabase.auth.onAuthStateChange((_event, session) => {
  adoptSession(session);
});

function isFresh(entry: CachedSession): entry is NonNullable<CachedSession> {
  return !!entry && entry.expiresAt - EXPIRY_SKEW_MS > Date.now();
}

async function getToken(): Promise<string | null> {
  if (sessionHydrated && isFresh(cachedSession)) return cachedSession.token;

  // Collapse concurrent misses (app launch fires several requests at once) into
  // a single storage read rather than one per caller.
  if (!hydrating) {
    hydrating = supabase.auth
      .getSession()
      .then(({ data: { session } }) => adoptSession(session))
      .catch(() => {
        // Leave the previous value in place: a transient storage error should
        // not sign the user out of an in-flight request.
        sessionHydrated = true;
      })
      .finally(() => {
        hydrating = null;
      });
  }
  // Read into a local first: the shared one is cleared as soon as it settles,
  // which can happen between the check above and this await.
  const pendingHydration = hydrating;
  await pendingHydration;

  return cachedSession?.token ?? null;
}

// ─── Fetch wrapper with timeout ────────────────────────────────────
export async function fetchWithTimeout(url: string, options: RequestInit = {}) {
  const timeoutMs = 15000; // 15 seconds
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal as any,
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// ─── Core fetch wrapper ───────────────────────────────────────────
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Logging every request costs a bridge crossing per call in dev and is noise
  // in release builds, where __DEV__ strips this entirely.
  if (__DEV__) {
    console.log(`[API Request] ${options.method || 'GET'} ${BASE_URL}${path}`);
  }
  const res = await fetchWithTimeout(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  // Parse body regardless of status
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // no-op — body might be empty
  }

  if (!res.ok) {
    // The API is inconsistent here: auth middleware returns `details`, the
    // error handler returns `detail`. Read both so the reason is never lost.
    throw new ApiError(
      res.status,
      body?.error ?? `HTTP ${res.status}`,
      body?.details ?? body?.detail,
    );
  }

  return body as T;
}

// ─── GET coalescing and short-lived cache ─────────────────────────
// Two separate concerns:
//
//   * Coalescing is always on. Mounting a screen often fires the same GET from
//     several components at once; without this each one opens its own socket.
//     A joiner does read the result of a request that started before it, so a
//     write must not leave a pre-write GET in the map for a later reader to
//     join — every mutation clears both maps below.
//
//   * Caching is opt-in per call via `ttlMs`, because most of this API is
//     read-write-read (feed, chat, swipes) where a stale body is a bug. Only
//     callers that know their data tolerates staleness pass a TTL.
const inFlight = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { body: unknown; expiresAt: number }>();

/**
 * Drops cached GETs whose path starts with `prefix`. Call after a mutation
 * that invalidates them — an unqualified call clears everything.
 */
export function invalidate(prefix = '') {
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
}

/**
 * `ttlMs` opts this path into the cache; `force` bypasses both the cache and
 * an in-flight request, which is what a pull-to-refresh needs — the user asked
 * for fresh data, so handing back a cached body makes the gesture look broken.
 * A forced call still refreshes the cached entry for later readers.
 */
async function get<T>(path: string, opts: { ttlMs?: number; force?: boolean } = {}): Promise<T> {
  const { ttlMs, force } = opts;

  if (ttlMs && !force) {
    const hit = responseCache.get(path);
    if (hit && hit.expiresAt > Date.now()) return hit.body as T;
  }

  const pending = inFlight.get(path);
  if (pending && !force) return pending as Promise<T>;

  const promise = request<T>(path, { method: 'GET' })
    .then((body) => {
      if (ttlMs) responseCache.set(path, { body, expiresAt: Date.now() + ttlMs });
      return body;
    })
    .finally(() => {
      inFlight.delete(path);
    });

  inFlight.set(path, promise);
  return promise;
}

/**
 * Any write can invalidate any GET, and this client has no dependency map
 * between them. Dropping every cached and in-flight read after a mutation is
 * the conservative choice: it costs a refetch, where the alternative costs
 * correctness. Cleared before the request is issued so a read started while
 * the write is still in flight cannot join a pre-write promise either.
 */
function mutate<T>(path: string, options: RequestInit): Promise<T> {
  responseCache.clear();
  inFlight.clear();
  return request<T>(path, options);
}

// ─── Convenience helpers ──────────────────────────────────────────
export const api = {
  get,
  post:   <T>(path: string, body: unknown)    => mutate<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)    => mutate<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)                   => mutate<T>(path, { method: 'DELETE' }),
};

export default api;
