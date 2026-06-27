import type { Paginated, AppItem } from "@duoplus/shared";
import { apiFetch } from "./client";

export function listPlatformApps(params: { page: number; pageSize: number }): Promise<Paginated<AppItem>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  return apiFetch<Paginated<AppItem>>(`/api/apps/platform?${qs}`);
}

export function listTeamApps(params: { page: number; pageSize: number }): Promise<Paginated<AppItem>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  return apiFetch<Paginated<AppItem>>(`/api/apps/team?${qs}`);
}

export function installApp(body: { image_ids: string[]; app_id: string; app_version_id?: string }): Promise<{ message: string }> {
  return apiFetch(`/api/apps/install`, { method: "POST", body: JSON.stringify(body) });
}

export function uninstallApp(body: { image_ids: string[]; pkg: string }): Promise<{ message: string }> {
  return apiFetch(`/api/apps/uninstall`, { method: "POST", body: JSON.stringify(body) });
}

export function startApp(body: { image_ids: string[]; pkg: string }): Promise<{ message: string }> {
  return apiFetch(`/api/apps/start`, { method: "POST", body: JSON.stringify(body) });
}

export function stopApp(body: { image_ids: string[]; pkg: string }): Promise<{ message: string }> {
  return apiFetch(`/api/apps/stop`, { method: "POST", body: JSON.stringify(body) });
}

export function listInstalledApps(imageId: string): Promise<{ list: string[] }> {
  const qs = new URLSearchParams({ imageId });
  return apiFetch<{ list: string[] }>(`/api/apps/installed?${qs}`);
}
