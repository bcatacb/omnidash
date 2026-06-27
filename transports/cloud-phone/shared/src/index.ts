export type PhonePowerState = "on" | "off" | "booting" | "expired" | "unknown";
export type PowerAction = "on" | "off" | "restart";

export const POWER_ACTIONS: PowerAction[] = ["on", "off", "restart"];

const POWER_STATES: PhonePowerState[] = ["on", "off", "booting", "expired", "unknown"];
export function isPowerState(v: string): v is PhonePowerState {
  return (POWER_STATES as string[]).includes(v);
}

export interface CloudPhone {
  id: string;
  name: string;
  powerState: PhonePowerState;
  statusCode: number;
  os: string;
  size: string;
  area: string;
  ip: string;
  group: string | null;
  adb: string;
  remark: string;
  createdAt: string;
  expiredAt: string;
}

export interface Proxy { id: string; name: string; host: string; port: number; user: string; area: string; }
export interface Group { id: string; name: string; sort: number; remark: string; }

export interface PhoneDetail {
  id: string;
  name?: string;
  remark?: string;
  os?: string;
  group?: { id: string; name: string }[];
  proxy?: { id?: string; dns?: string; ip?: string; country?: string; region?: string; city?: string; zipcode?: string };
  gps?: { longitude?: number; latitude?: number };
  locale?: { timezone?: string; language?: string };
  sim?: { status?: number; country?: string; msisdn?: string; operator?: string; msin?: string; iccid?: string; mcc?: string; mnc?: string };
  bluetooth?: { name?: string; address?: string };
  wifi?: { status?: number; name?: string; mac?: string; bssid?: string };
  device?: { manufacturer?: string; brand?: string; model?: string; imei?: string; serialno?: string; android_id?: string; gsf_id?: string; gaid?: string };
}

export interface AppItem { id: string; name: string; pkg: string; version_list: { id: string; name: string }[]; }
export interface DriveFile { id: string; name: string; original_file_name: string; }

export interface CloudNumber { id: string; phone_number: string; region_name: string; type_name: string; status_name: string; renewal_status: number; remark: string; created_at: string; expired_at: string; }
export interface NumberSms { message: string; code: string; received_at: string; }
export interface Order { type: string; order_id: string; product: string; description: string; status: string; total: string; created_at: string; expired_at: string; }
export interface Subscription { id: string; name: string; cpu: string; ram: string; rom: string; renewal_status: number; free_status: number; remark: string; expired_at: string; created_at: string; need_renewal: boolean; }

export interface Tag { id: string; name: string; color: string; image_count: number; }
export interface ResourceItem { name: string; region_id: string; os: string; count: number; used_count: number; }

export interface Template { id: string; name: string; desc: string; }
export interface ScheduledTask { id: string; name: string; task_type_name: string; image_name: string; ip: string; status: number; issue_at: string; created_at: string; }
export interface LoopTask { id: string; name: string; remark: string; task_type_name: string; status: number; created_at: string; }

export interface Paginated<T> { items: T[]; page: number; pageSize: number; total: number; }
export interface BatchOpResult { id: string; ok: boolean; error?: string; }
export interface BatchResponse { results: BatchOpResult[]; }
export interface ApiErrorBody { error: string; upstreamCode?: number; upstreamMsg?: string; upstreamStatus?: number; }
