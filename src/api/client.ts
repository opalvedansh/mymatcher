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
async function getToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? null;

    // ── Safe auth diagnostics (no token value is ever logged) ──────
    const sessionExists = !!session;
    const accessTokenExists = !!token;
    const tokenLength = token?.length ?? 0;
    const jwtPartCount = token ? token.split('.').length : 0;
    const tokenType = token !== null ? typeof token : 'null';
    console.log(
      `[Auth Debug] getToken() →`,
      `sessionExists=${sessionExists}`,
      `accessTokenExists=${accessTokenExists}`,
      `tokenType=${tokenType}`,
      `tokenLength=${tokenLength}`,
      `jwtPartCount=${jwtPartCount}`,
    );
    // ───────────────────────────────────────────────────────────────

    return token;
  } catch {
    return null;
  }
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

  console.log(`[API Request] ${options.method || 'GET'} ${BASE_URL}${path}`);
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
    throw new ApiError(
      res.status,
      body?.error ?? `HTTP ${res.status}`,
      body?.detail,
    );
  }

  return body as T;
}

// ─── Convenience helpers ──────────────────────────────────────────
export const api = {
  get:    <T>(path: string)                   => request<T>(path, { method: 'GET' }),
  post:   <T>(path: string, body: unknown)    => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)    => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)                   => request<T>(path, { method: 'DELETE' }),
};

export default api;
