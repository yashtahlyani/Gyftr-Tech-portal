/* ─── Thin API client — replaces every direct `supabase.from(...)` call.
   Attaches the current Cognito ID token to every request; auth.ts owns
   getAuthToken()/setAuthToken(). ─── */

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");

let authToken: string | null = null;
export function setAuthToken(token: string | null) { authToken = token; }
export function getAuthToken(): string | null { return authToken; }

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new Error("VITE_API_URL is not set.");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (body && body.error) || res.statusText, body);
  return body as T;
}

export const get = <T,>(path: string) => apiFetch<T>(path, { method: "GET" });
export const post = <T,>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
export const patch = <T,>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined });
export const put = <T,>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined });
export const del = <T,>(path: string) => apiFetch<T>(path, { method: "DELETE" });
