import type { Paginated, CloudNumber, NumberSms } from "@duoplus/shared";
import { apiFetch } from "./client";

export function listNumbers(params: { page: number; pageSize: number }): Promise<Paginated<CloudNumber>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  return apiFetch<Paginated<CloudNumber>>(`/api/numbers?${qs}`);
}

export function listSms(params: { id: string; page: number; pageSize: number }): Promise<Paginated<NumberSms>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  return apiFetch<Paginated<NumberSms>>(`/api/numbers/${encodeURIComponent(params.id)}/sms?${qs}`);
}

export function purchaseNumberPackage(body: { region: string; type?: string }): Promise<{ duration: string[] }> {
  return apiFetch(`/api/numbers/package`, { method: "POST", body: JSON.stringify(body) });
}

export function getRenewalPackage(number_ids: string[]): Promise<{ numbers: Array<{ id: string; phone_number: string; expired_at: string; duration: number[] }> }> {
  return apiFetch(`/api/numbers/renewal-package`, { method: "POST", body: JSON.stringify({ number_ids }) });
}

export function purchaseNumber(body: unknown): Promise<{ order_id: string }> {
  return apiFetch(`/api/numbers/purchase`, { method: "POST", body: JSON.stringify(body) });
}

export function renewNumbers(list: Array<{ number_ids: string[]; duration: number }>): Promise<{ order_id: string }> {
  return apiFetch(`/api/numbers/renew`, { method: "POST", body: JSON.stringify({ list }) });
}
