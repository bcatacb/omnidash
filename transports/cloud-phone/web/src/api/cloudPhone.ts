import type { Paginated, CloudPhone, BatchResponse, PowerAction } from "@duoplus/shared";
import { apiFetch } from "./client";

export function listPhones(params: { page: number; pageSize: number }): Promise<Paginated<CloudPhone>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  return apiFetch<Paginated<CloudPhone>>(`/api/phones?${qs}`);
}

export async function listAllPhones(): Promise<CloudPhone[]> {
  const pageSize = 100;
  const first = await listPhones({ page: 1, pageSize });
  const all = [...first.items];
  const pages = Math.ceil(first.total / pageSize);
  for (let p = 2; p <= pages; p++) {
    const r = await listPhones({ page: p, pageSize });
    all.push(...r.items);
  }
  return all;
}

export function batchPower(ids: string[], action: PowerAction): Promise<BatchResponse> {
  return apiFetch<BatchResponse>(`/api/phones/power`, { method: "POST", body: JSON.stringify({ ids, action }) });
}
