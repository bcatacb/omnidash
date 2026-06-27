import type { Paginated, DriveFile } from "@duoplus/shared";
import { apiFetch, consoleTokenHeader } from "./client";

export interface SignedUrlResult {
  method: string;
  signedUrl: string;
  headers: Record<string, string>;
  name: string;
  original_file_name: string;
}

export function listDriveFiles(params: { keyword?: string; page: number; pageSize: number }): Promise<Paginated<DriveFile>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.keyword) qs.set("keyword", params.keyword);
  return apiFetch<Paginated<DriveFile>>(`/api/drive/files?${qs}`);
}

export function pushFiles(body: { ids: string[]; image_ids: string[]; dest_dir: string }): Promise<{ message: string; success: unknown[]; fail: unknown[] }> {
  return apiFetch(`/api/drive/push`, { method: "POST", body: JSON.stringify(body) });
}

export function deleteFiles(ids: string[]): Promise<{ message: string }> {
  return apiFetch(`/api/drive/delete`, { method: "POST", body: JSON.stringify({ ids }) });
}

export function mintUploadUrl(body: { name: string; is_app?: number; pkg?: string }): Promise<SignedUrlResult> {
  return apiFetch<SignedUrlResult>(`/api/drive/upload-url`, { method: "POST", body: JSON.stringify(body) });
}

export interface UploadResult { name: string; original_file_name: string; }

// Uploads a browser File via multipart to the proxy, which performs the OSS PUT
// server-side. Do NOT set Content-Type — the browser sets the multipart boundary.
export async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/drive/upload`, { method: "POST", body: form, headers: { ...consoleTokenHeader() } });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const b = await res.json() as { error?: string }; if (b?.error) message = b.error; } catch { /* non-json */ }
    throw new Error(message);
  }
  return (await res.json()) as UploadResult;
}
