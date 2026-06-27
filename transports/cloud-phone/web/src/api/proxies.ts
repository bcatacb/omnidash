import type { Paginated, Proxy } from "@duoplus/shared";
import { apiFetch } from "./client";

export interface ProxyAddItem { protocol: string; host: string; port: number; user?: string; password?: string; name?: string; }
export interface ProxyAddResult { success: { index: number; id: string }[]; fail: { index: number; message: string }[]; }
export interface BatchIdResult { success: string[]; fail: string[]; }

export function listProxies(params: { page: number; pageSize: number }): Promise<Paginated<Proxy>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  return apiFetch<Paginated<Proxy>>(`/api/proxies?${qs}`);
}

export function addProxies(proxy_list: ProxyAddItem[], ip_scan_channel?: string): Promise<ProxyAddResult> {
  return apiFetch<ProxyAddResult>(`/api/proxies`, { method: "POST", body: JSON.stringify({ proxy_list, ip_scan_channel }) });
}

export function deleteProxies(ids: string[]): Promise<BatchIdResult> {
  return apiFetch<BatchIdResult>(`/api/proxies/delete`, { method: "POST", body: JSON.stringify({ ids }) });
}

export function refreshProxies(ids: string[]): Promise<BatchIdResult> {
  return apiFetch<BatchIdResult>(`/api/proxies/refresh`, { method: "POST", body: JSON.stringify({ ids }) });
}

export function updateProxy(body: { id: string; host?: string; port?: number; user?: string; password?: string; name?: string }): Promise<{ message: string; result: unknown[] }> {
  return apiFetch(`/api/proxies/update`, { method: "POST", body: JSON.stringify(body) });
}
