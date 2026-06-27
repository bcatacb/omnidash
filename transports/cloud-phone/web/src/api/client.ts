import type { ApiErrorBody } from "@duoplus/shared";

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody | null) {
    super(body?.error ?? `HTTP ${status}`);
  }
}

// When the deployment requires a console token, the proxy gates /api/ behind
// x-console-token. The token is baked in at build time via VITE_CONSOLE_TOKEN.
export const consoleTokenHeader = (): Record<string, string> => {
  const t = import.meta.env.VITE_CONSOLE_TOKEN;
  return t ? { "x-console-token": t } : {};
};

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...consoleTokenHeader(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try { body = (await res.json()) as ApiErrorBody; } catch { /* non-json */ }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}
