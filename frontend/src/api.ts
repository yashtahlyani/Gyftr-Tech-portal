/* ─── Thin fetch wrapper over the backend/ Express API — replaces the
   @supabase/supabase-js client. Every request carries the current Cognito ID
   token (auth.ts's getIdToken(), which transparently refreshes an expired
   token from the refresh token) as `Authorization: Bearer <token>`.

   Response shapes are unchanged from what Supabase/PostgREST returned —
   backend/serialize.js builds the identical nested snake_case JSON — so
   cloudStore.ts's mapProject()/mapSubtask()/etc. don't need to change,
   only their transport does. ─── */
import { getIdToken } from "./auth";
import type { Person, DocKind, StageId } from "./types";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8978";

if (!import.meta.env.VITE_API_URL) {
  console.warn(
    "[api] VITE_API_URL is not set — falling back to http://localhost:8978. " +
    "For a deployed build this must be baked in at build time (see frontend/buildspec.yml)."
  );
}

// A security-group-dropped connection or an unhealthy ALB target leaves fetch
// hanging forever, which presents as a button stuck on "Saving…" with nothing
// in the console. Time it out and say so.
const REQUEST_TIMEOUT_MS = 15000;

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Generic fetch wrapper: attaches the bearer token, JSON-encodes a plain
 *  object body, times the request out, and throws an Error whose `.message`
 *  is the server's `{error}` string on a non-2xx response — matching what
 *  cloudStore.ts's writeFailed() callers already expect from `.message`. */
export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string> | undefined),
  };
  const token = await getIdToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`The server did not respond within ${REQUEST_TIMEOUT_MS / 1000}s (${API_URL}).`);
    }
    throw new Error(`Could not reach the server at ${API_URL}. Check the API is running and its CORS origin matches this site.`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return null as T;
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = (body && typeof body === "object" && "error" in body ? (body as Row).error : null)
      ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

const get = <T = unknown>(path: string) => apiFetch<T>(path);
const post = <T = unknown>(path: string, body?: Row) => apiFetch<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
const patch = <T = unknown>(path: string, body?: Row) => apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });
const put = <T = unknown>(path: string, body?: Row) => apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) });
const del = <T = unknown>(path: string) => apiFetch<T>(path, { method: "DELETE" });

/* ── Typed helpers, one per backend route ── */

export function fetchPeople(): Promise<Row[]> {
  return get<Row[]>("/api/people");
}

/** GET /api/me — the `people` row middleware/identity.js linked to this
 *  Cognito identity (auto-linked by email on first sign-in). There is no
 *  separate "who am I" concept beyond that row, so this is the simplest,
 *  single source of truth for the signed-in Person. */
export function fetchMe(): Promise<Person> {
  return get<Row>("/api/me").then((r) => ({
    id: r.id, name: r.name, team: r.team, role: r.role, email: r.email,
    managerId: r.manager_id ?? undefined, department: r.department ?? undefined,
    seesAllProjects: r.sees_all_projects ?? false, active: r.active ?? true,
  }));
}

export function fetchProjects(): Promise<Row[]> {
  return get<Row[]>("/api/projects");
}

export function createProjectRow(body: Row): Promise<Row> {
  return post<Row>("/api/projects", body);
}

export function patchProjectRow(id: string, body: Row): Promise<Row> {
  return patch<Row>(`/api/projects/${id}`, body);
}

export function deleteProjectRow(id: string): Promise<void> {
  return del(`/api/projects/${id}`);
}

export function createSubtaskRow(projectId: string, body: Row): Promise<Row> {
  return post<Row>(`/api/projects/${projectId}/subtasks`, body);
}

export function patchSubtaskRow(id: string, body: Row): Promise<Row> {
  return patch<Row>(`/api/subtasks/${id}`, body);
}

export function deleteSubtaskRow(id: string): Promise<void> {
  return del(`/api/subtasks/${id}`);
}

export function createCommentRow(projectId: string, text: string, pinned: boolean): Promise<Row> {
  return post<Row>(`/api/projects/${projectId}/comments`, { text, pinned });
}

export function patchCommentRow(id: string, resolved: boolean): Promise<Row> {
  return patch<Row>(`/api/comments/${id}`, { resolved });
}

export function createAttachmentRow(projectId: string, name: string, kind: DocKind, url?: string): Promise<Row> {
  return post<Row>(`/api/projects/${projectId}/attachments`, { name, kind, url });
}

export function putStageTargetRow(projectId: string, stage: StageId, expectedDate: string | null): Promise<Row> {
  return put<Row>(`/api/projects/${projectId}/stage-targets/${stage}`, { expectedDate });
}
