import type { Paginated, Tag, ResourceItem } from "@duoplus/shared";
import { apiFetch } from "./client";

// Nested brand -> model_id -> { name }
export type ModelList = Record<string, Record<string, { name: string }>>;

export function getModels(os: number): Promise<ModelList> {
  return apiFetch<ModelList>(`/api/reference/models?os=${encodeURIComponent(String(os))}`);
}

export function getResources(): Promise<{ list: ResourceItem[] }> {
  return apiFetch<{ list: ResourceItem[] }>(`/api/reference/resources`);
}

export function getResolutions(): Promise<{ list: string[] }> {
  return apiFetch<{ list: string[] }>(`/api/reference/resolutions`);
}

export function getTags(params: { name?: string; page?: number; pageSize?: number } = {}): Promise<Paginated<Tag>> {
  const qs = new URLSearchParams({ page: String(params.page ?? 1), pageSize: String(params.pageSize ?? 20) });
  if (params.name) qs.set("name", params.name);
  return apiFetch<Paginated<Tag>>(`/api/reference/tags?${qs}`);
}
