import type { Paginated, Template, ScheduledTask, LoopTask } from "@duoplus/shared";
import { apiFetch } from "./client";

export interface TaskLog { id: string; result_info: { action?: string; result?: boolean }; start_at: string; finish_at: string; created_at: string; }
export interface TaskLogResponse { list: TaskLog[]; [k: string]: unknown; }
export interface BatchTaskResult { success: string[]; fail: string[]; fail_reason?: Record<string, string>; }

export function listTemplates(params: { type: "custom" | "official"; page: number; pageSize: number; name?: string }): Promise<Paginated<Template>> {
  const qs = new URLSearchParams({ type: params.type, page: String(params.page), pageSize: String(params.pageSize) });
  if (params.name) qs.set("name", params.name);
  return apiFetch<Paginated<Template>>(`/api/automation/templates?${qs}`);
}

export function listScheduled(params: { page: number; pageSize: number; issueStart?: string; issueEnd?: string }): Promise<Paginated<ScheduledTask>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.issueStart) qs.set("issueStart", params.issueStart);
  if (params.issueEnd) qs.set("issueEnd", params.issueEnd);
  return apiFetch<Paginated<ScheduledTask>>(`/api/automation/scheduled?${qs}`);
}

export function listLoop(params: { page: number; pageSize: number; name?: string }): Promise<Paginated<LoopTask>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.name) qs.set("name", params.name);
  return apiFetch<Paginated<LoopTask>>(`/api/automation/loop?${qs}`);
}

export function createScheduled(body: unknown): Promise<{ message: string }> {
  return apiFetch(`/api/automation/scheduled`, { method: "POST", body: JSON.stringify(body) });
}

export function createLoop(body: unknown): Promise<{ id: string }> {
  return apiFetch(`/api/automation/loop`, { method: "POST", body: JSON.stringify(body) });
}

export function saveLoop(body: unknown): Promise<{ id: string }> {
  return apiFetch(`/api/automation/loop/save`, { method: "POST", body: JSON.stringify(body) });
}

export function setLoopStatus(body: { id: string; status: number }): Promise<{ id: string }> {
  return apiFetch(`/api/automation/loop/status`, { method: "POST", body: JSON.stringify(body) });
}

export function deleteLoop(id: string): Promise<{ message: string }> {
  return apiFetch(`/api/automation/loop/delete`, { method: "POST", body: JSON.stringify({ id }) });
}

export function getReport(params: { taskId: string; cursorId?: string }): Promise<TaskLogResponse> {
  const qs = new URLSearchParams({ taskId: params.taskId });
  if (params.cursorId) qs.set("cursorId", params.cursorId);
  return apiFetch<TaskLogResponse>(`/api/automation/report?${qs}`);
}

export function setScheduledStatus(body: { ids: string[]; status: number }): Promise<BatchTaskResult> {
  return apiFetch(`/api/automation/scheduled/status`, { method: "POST", body: JSON.stringify(body) });
}

export function updateScheduledTime(body: { id: string; issue_at: string }): Promise<{ message: string }> {
  return apiFetch(`/api/automation/scheduled/time`, { method: "POST", body: JSON.stringify(body) });
}
