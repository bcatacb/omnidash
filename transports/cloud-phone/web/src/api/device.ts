import type { PhoneDetail } from "@duoplus/shared";
import { apiFetch } from "./client";

export interface BatchRootResult { success: string[]; fail: string[]; fail_reason?: Record<string, string>; }
export interface AdbResult { success: boolean; content: string; message: string; }
export type AdbMultiResult = Record<string, AdbResult>;

export function getPhoneInfo(id: string): Promise<PhoneDetail> {
  return apiFetch<PhoneDetail>(`/api/phones/${encodeURIComponent(id)}`);
}

export function batchRoot(body: { image_ids: string[]; status: number; pkgs?: string[] }): Promise<BatchRootResult> {
  return apiFetch(`/api/phones/root`, { method: "POST", body: JSON.stringify(body) });
}

export function resetPhone(body: { image_id: string; [k: string]: unknown }): Promise<{ message: string }> {
  return apiFetch(`/api/phones/reset`, { method: "POST", body: JSON.stringify(body) });
}

export function sharePhones(share: unknown[]): Promise<Record<string, string>> {
  return apiFetch(`/api/phones/share`, { method: "POST", body: JSON.stringify({ share }) });
}

export function setSharePassword(images: { image_id: string; password: string }[]): Promise<{ message: string }> {
  return apiFetch(`/api/phones/share-password`, { method: "POST", body: JSON.stringify({ images }) });
}

export function writeSms(body: { image_id: string[]; sms: { phone: string; message: string }[] }): Promise<{ message: string }> {
  return apiFetch(`/api/phones/write-sms`, { method: "POST", body: JSON.stringify(body) });
}

export function setLive(body: { image_id: string; status: number; id?: string; loop?: number }): Promise<{ message: string }> {
  return apiFetch(`/api/phones/live`, { method: "POST", body: JSON.stringify(body) });
}

export function scanCode(body: { image_id: string; id: string }): Promise<{ message: string }> {
  return apiFetch(`/api/phones/scan`, { method: "POST", body: JSON.stringify(body) });
}

export function runAdb(body: { image_id?: string; image_ids?: string[]; command: string }): Promise<AdbResult | AdbMultiResult> {
  return apiFetch(`/api/phones/adb`, { method: "POST", body: JSON.stringify(body) });
}

export function enableAdb(image_ids: string[]): Promise<BatchRootResult> {
  return apiFetch(`/api/phones/adb/enable`, { method: "POST", body: JSON.stringify({ image_ids }) });
}

export function disableAdb(image_ids: string[]): Promise<BatchRootResult> {
  return apiFetch(`/api/phones/adb/disable`, { method: "POST", body: JSON.stringify({ image_ids }) });
}

export function listMembers(): Promise<{ list: { user_id: string; nickname: string }[] }> {
  return apiFetch(`/api/phones/members`);
}
