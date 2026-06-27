// CloudPhoneClient — implements @omnibox/core's CloudPhoneTransport by calling the
// DuoPlus proxy (transports/cloud-phone/proxy). The proxy keeps the DuoPlus API key
// server-side and enforces the 1-QPS limit; this client just speaks its REST API.
//
// Mobile-first platform engines (Snapchat / Instagram / Facebook) depend on this
// instead of touching DuoPlus directly.

import type {
  CloudPhoneTransport,
  CloudPhoneDevice,
  CloudPhoneStatus,
  AdbResult,
  CloudSms,
} from '@omnibox/core'

export * from './uiautomator'
export * from './vision'

export interface CloudPhoneClientOptions {
  /** Base URL of the DuoPlus proxy, e.g. http://localhost:4000 */
  baseUrl: string
  /** Optional shared secret — sent as x-console-token when the proxy has CONSOLE_TOKEN set. */
  consoleToken?: string
  /** Override fetch (tests). Defaults to global fetch. */
  fetch?: typeof fetch
}

function mapDevice(raw: any): CloudPhoneDevice {
  return {
    id: String(raw.id ?? raw.image_id ?? ''),
    name: String(raw.name ?? ''),
    status: (raw.status ?? 0) as CloudPhoneStatus,
    groups: Array.isArray(raw.group)
      ? raw.group.map((g: any) => ({ id: String(g.id), name: String(g.name) }))
      : raw.groups,
    proxy: raw.proxy
      ? { id: raw.proxy.id, ip: raw.proxy.ip, country: raw.proxy.country }
      : null,
    // After enableAdb(), DuoPlus surfaces the reachable ADB endpoint on the device record.
    adb: raw.adb && (raw.adb.host || raw.adb.ip)
      ? { host: String(raw.adb.host ?? raw.adb.ip), port: Number(raw.adb.port) }
      : (raw.adb_host && raw.adb_port
          ? { host: String(raw.adb_host), port: Number(raw.adb_port) }
          : null),
    device: raw.device
      ? {
          manufacturer: raw.device.manufacturer,
          model: raw.device.model,
          androidId: raw.device.android_id,
          imei: raw.device.imei,
        }
      : undefined,
  }
}

export class CloudPhoneClient implements CloudPhoneTransport {
  private base: string
  private token?: string
  private _fetch: typeof fetch

  constructor(opts: CloudPhoneClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '')
    this.token = opts.consoleToken
    this._fetch = opts.fetch ?? globalThis.fetch
  }

  private async req<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.token) headers['x-console-token'] = this.token
    const res = await this._fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`cloud-phone proxy ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`)
    }
    return (await res.json()) as T
  }

  // ── device pool ──────────────────────────────────────────────
  async listDevices(opts?: { groupId?: string; page?: number }): Promise<CloudPhoneDevice[]> {
    const page = opts?.page ?? 1
    const data = await this.req<{ items: any[] }>('GET', `/api/phones?page=${page}&pageSize=200`)
    let items = (data.items ?? []).map(mapDevice)
    if (opts?.groupId) items = items.filter((d) => d.groups?.some((g) => g.id === opts.groupId))
    return items
  }

  async getDevice(deviceId: string): Promise<CloudPhoneDevice> {
    const raw = await this.req('GET', `/api/phones/${encodeURIComponent(deviceId)}`)
    return mapDevice(raw)
  }

  private power(ids: string[], action: 'on' | 'off' | 'restart') {
    return this.req('POST', '/api/phones/power', { ids, action })
  }
  async powerOn(ids: string[]) { await this.power(ids, 'on') }
  async powerOff(ids: string[]) { await this.power(ids, 'off') }
  async restart(ids: string[]) { await this.power(ids, 'restart') }

  // ── raw automation ───────────────────────────────────────────
  async enableAdb(ids: string[]) { await this.req('POST', '/api/phones/adb/enable', { image_ids: ids }) }
  async disableAdb(ids: string[]) { await this.req('POST', '/api/phones/adb/disable', { image_ids: ids }) }

  async adb(deviceId: string, command: string): Promise<AdbResult> {
    const r = await this.req<any>('POST', '/api/phones/adb', { image_id: deviceId, command })
    // single image_id → { success, content, message }
    return { success: !!r.success, content: String(r.content ?? ''), message: r.message }
  }

  /** DuoPlusDumpUI writes the UIAutomator tree to a file; we then read it back. */
  async dumpUi(deviceId: string): Promise<string> {
    const path = '/sdcard/uidump.xml'
    await this.adb(deviceId, `DuoPlusDumpUI ${path}`)
    const r = await this.adb(deviceId, `cat ${path}`)
    return r.content
  }

  /** screencap → base64 → PNG bytes. Verified working against the live DuoPlus fleet. */
  async screenshot(deviceId: string): Promise<Uint8Array> {
    const path = '/sdcard/_omni_shot.png'
    await this.adb(deviceId, `screencap -p ${path}`)
    const r = await this.adb(deviceId, `base64 ${path}`)
    const b64 = r.content.replace(/\s+/g, '')
    return Uint8Array.from(Buffer.from(b64, 'base64'))
  }

  // ── apps ─────────────────────────────────────────────────────
  async installApp(ids: string[], appId: string, appVersionId?: string) {
    await this.req('POST', '/api/apps/install', { image_ids: ids, app_id: appId, app_version_id: appVersionId })
  }
  async startApp(ids: string[], pkg: string) { await this.req('POST', '/api/apps/start', { image_ids: ids, pkg }) }
  async stopApp(ids: string[], pkg: string) { await this.req('POST', '/api/apps/stop', { image_ids: ids, pkg }) }
  async installedApps(deviceId: string): Promise<string[]> {
    const r = await this.req<{ list: string[] }>('GET', `/api/apps/installed?imageId=${encodeURIComponent(deviceId)}`)
    return r.list ?? []
  }

  // ── onboarding ───────────────────────────────────────────────
  async listSms(numberId: string): Promise<CloudSms[]> {
    const r = await this.req<{ list?: any[]; items?: any[] }>('GET', `/api/numbers/${encodeURIComponent(numberId)}/sms`)
    const list = r.list ?? r.items ?? []
    return list.map((s: any) => ({
      message: String(s.message ?? ''),
      code: s.code ? String(s.code) : undefined,
      receivedAt: String(s.received_at ?? s.receivedAt ?? ''),
    }))
  }

  // ── media ────────────────────────────────────────────────────
  async pushMedia(deviceIds: string[], fileIds: string[], destDir: string) {
    await this.req('POST', '/api/drive/push', { image_ids: deviceIds, ids: fileIds, dest_dir: destDir })
  }

  // ── isolation ────────────────────────────────────────────────
  async assignProxy(deviceId: string, proxyId: string) {
    await this.req('POST', '/api/phones/modify', { images: [{ image_id: deviceId, proxy: { id: proxyId } }] })
  }

  // ── bulk automation (DuoPlus RPA) ────────────────────────────
  async runTemplate(opts: {
    templateId: string
    templateType: number
    name: string
    deviceIds: string[]
    config?: unknown
    issueAt?: string
  }): Promise<{ taskId?: string }> {
    const r = await this.req<any>('POST', '/api/automation/scheduled', {
      template_id: opts.templateId,
      template_type: opts.templateType,
      name: opts.name,
      images: opts.deviceIds.map((id) => ({ image_id: id, config: opts.config, issue_at: opts.issueAt })),
    })
    return { taskId: r.id ?? r.task_id }
  }
}
