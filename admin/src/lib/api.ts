import { supabase } from './supabase';

/**
 * Ported from src/api/client.ts so the two behave the same: the same error
 * shape, the same 15s timeout, the same Bearer header from the live Supabase
 * session rather than a token this app stores itself.
 *
 * What is added here: a 401 handler that signs out instead of looping, and a
 * 403 that surfaces `required_permission` so the UI can say which permission
 * was missing rather than "forbidden".
 *
 * What is dropped: the [Auth Debug] line the mobile client logs on every
 * request.
 */
const TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  requiredPermission?: string;
  yourRole?: string;
  code?: string;

  constructor(status: number, message: string, body?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = body?.details ?? body?.detail;
    this.requiredPermission = body?.required_permission as string | undefined;
    this.yourRole = body?.your_role as string | undefined;
    this.code = body?.code as string | undefined;
  }

  /** Validation errors come back as a list of {field, message}. */
  get fieldErrors(): { field: string; message: string }[] {
    return Array.isArray(this.detail) ? (this.detail as { field: string; message: string }[]) : [];
  }
}

type OnUnauthorized = () => void;
let onUnauthorized: OnUnauthorized = () => {};
export function setUnauthorizedHandler(fn: OnUnauthorized) {
  onUnauthorized = fn;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeader()),
        ...(init.headers as Record<string, string>),
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(0, `Request timed out after ${TIMEOUT_MS / 1000}s`);
    }
    throw new ApiError(0, 'Could not reach the API');
  }
  clearTimeout(timer);

  let body: Record<string, unknown> | null = null;
  try {
    body = await res.json();
  } catch {
    /* 204s and streamed responses have no JSON body */
  }

  if (!res.ok) {
    // An expired or revoked session must drop the operator at the login
    // screen, not leave every panel showing a red box.
    if (res.status === 401) onUnauthorized();
    throw new ApiError(res.status, (body?.error as string) ?? `HTTP ${res.status}`, body ?? undefined);
  }

  return body as T;
}

const qs = (params: Record<string, unknown> = {}) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) => request<T>(`/api/admin${path}${qs(params)}`),
  post: <T>(path: string, body?: unknown) =>
    request<T>(`/api/admin${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(`/api/admin${path}`, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(`/api/admin${path}`, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string, body?: unknown, params?: Record<string, unknown>) =>
    request<T>(`/api/admin${path}${qs(params)}`, { method: 'DELETE', body: JSON.stringify(body ?? {}) }),

  /**
   * Streamed CSV. Fetched rather than linked so the Authorization header is
   * sent — the export routes are token-authenticated like everything else.
   */
  async download(path: string, params: Record<string, unknown>, filename: string) {
    const res = await fetch(`/api/admin${path}${qs(params)}`, { headers: await authHeader() });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body ?? undefined);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

export { qs };
