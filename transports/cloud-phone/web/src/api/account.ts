import type { Paginated, Order, Subscription } from "@duoplus/shared";
import { apiFetch } from "./client";

export function listOrders(params: { page: number; pageSize: number; createdStart?: string; createdEnd?: string }): Promise<Paginated<Order>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.createdStart) qs.set("createdStart", params.createdStart);
  if (params.createdEnd) qs.set("createdEnd", params.createdEnd);
  return apiFetch<Paginated<Order>>(`/api/orders?${qs}`);
}

export function listSubscriptions(params: { page: number; pageSize: number; freeStatus?: number }): Promise<Paginated<Subscription>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.freeStatus !== undefined) qs.set("freeStatus", String(params.freeStatus));
  return apiFetch<Paginated<Subscription>>(`/api/subscriptions?${qs}`);
}

export function purchaseSubscription(body: unknown): Promise<{ order_id: string }> {
  return apiFetch(`/api/subscriptions/purchase`, { method: "POST", body: JSON.stringify(body) });
}

export function renewSubscription(body: { phone_ids: string[]; duration: number; coupon_code?: string }): Promise<{ order_id: string }> {
  return apiFetch(`/api/subscriptions/renew`, { method: "POST", body: JSON.stringify(body) });
}
