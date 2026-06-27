import { apiFetch } from "./client";

export interface ModifyResult { success: string[]; fail: string[]; fail_reason?: Record<string, string>; }

export function buyPhones(body: { os: string; duration: number; quantity: number; coupon_code?: string; renewal_status?: number }): Promise<{ order_id: string }> {
  return apiFetch(`/api/phones/buy`, { method: "POST", body: JSON.stringify(body) });
}

export function renewPhones(body: { image_ids: string[]; duration: number; coupon_code?: string }): Promise<{ order_id: string }> {
  return apiFetch(`/api/phones/renew`, { method: "POST", body: JSON.stringify(body) });
}

export function modifyPhones(images: Array<{ image_id: string; name?: string; remark?: string; [k: string]: unknown }>): Promise<ModifyResult> {
  return apiFetch(`/api/phones/modify`, { method: "POST", body: JSON.stringify({ images }) });
}
