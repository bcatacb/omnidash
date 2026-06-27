import type { CloudPhone, BatchResponse, PhonePowerState } from "@duoplus/shared";
import { type Envelope, UpstreamError, HttpStatusError } from "./core.js";

// Re-export so existing imports keep working. Envelope is a type-only re-export.
export { UpstreamError, HttpStatusError };
export type { Envelope };

export interface RawGroup { id: string; name: string; }
export interface CloudPhoneRaw {
  id: string; name: string; status: number; os: string; size: string;
  created_at: string; expired_at: string; ip: string; area: string;
  remark: string; adb: string; adb_password: string; group: RawGroup[];
}

export function unwrap<T>(env: Envelope<T>): T {
  if (env.code !== 200) throw new UpstreamError(env.code, env.message);
  return env.data;
}

export function mapStatus(code: number): PhonePowerState {
  switch (code) {
    case 1: return "on";
    case 2: return "off";
    case 10: case 11: return "booting";
    case 3: case 4: return "expired";
    default: return "unknown";
  }
}

export function mapPhone(raw: CloudPhoneRaw): CloudPhone {
  return {
    id: raw.id, name: raw.name, powerState: mapStatus(raw.status), statusCode: raw.status,
    os: raw.os, size: raw.size, area: raw.area, ip: raw.ip,
    group: raw.group && raw.group.length > 0 ? raw.group[0].name : null,
    adb: raw.adb, remark: raw.remark, createdAt: raw.created_at, expiredAt: raw.expired_at,
  };
}

export function mapBatch(data: { success: string[]; fail: string[] }): BatchResponse {
  return {
    results: [
      ...data.success.map((id) => ({ id, ok: true })),
      ...data.fail.map((id) => ({ id, ok: false, error: "operation failed" })),
    ],
  };
}
