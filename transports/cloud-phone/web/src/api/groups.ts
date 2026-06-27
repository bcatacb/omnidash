import type { Paginated, Group } from "@duoplus/shared";
import { apiFetch } from "./client";

export interface GroupWithCount extends Group { image_count?: number; }
export interface GroupCreateItem { name: string; sort?: number; remark?: string; }
export interface GroupUpdateItem { id: string; name: string; sort?: number; remark?: string; }
export interface GroupMutateResult { success: { index: number; id: string; name: string; sort: number; remark: string }[]; fail: { index: number; code?: number; message: string }[]; }
export interface BatchIdResult { success: string[]; fail: string[]; }

export function listGroups(params: { page: number }): Promise<Paginated<GroupWithCount>> {
  const qs = new URLSearchParams({ page: String(params.page) });
  return apiFetch<Paginated<GroupWithCount>>(`/api/groups?${qs}`);
}

export function createGroups(list: GroupCreateItem[]): Promise<GroupMutateResult> {
  return apiFetch<GroupMutateResult>(`/api/groups`, { method: "POST", body: JSON.stringify({ list }) });
}

export function updateGroups(list: GroupUpdateItem[]): Promise<GroupMutateResult> {
  return apiFetch<GroupMutateResult>(`/api/groups/update`, { method: "POST", body: JSON.stringify({ list }) });
}

export function deleteGroups(ids: string[]): Promise<BatchIdResult> {
  return apiFetch<BatchIdResult>(`/api/groups/delete`, { method: "POST", body: JSON.stringify({ ids }) });
}

export function assignToGroup(id: string, image_ids: string[]): Promise<{ message: string }> {
  return apiFetch(`/api/groups/assign`, { method: "POST", body: JSON.stringify({ id, image_ids }) });
}

export function moveToGroup(id: string, image_ids: string[]): Promise<{ message: string }> {
  return apiFetch(`/api/groups/move`, { method: "POST", body: JSON.stringify({ id, image_ids }) });
}
