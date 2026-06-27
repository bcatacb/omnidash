// CloudPhoneTransport — the contract for driving real Android apps on DuoPlus
// cloud phones. Implemented by transports/cloud-phone (which wraps the absorbed
// duoapi proxy + the DuoPlus API). Consumed by the mobile-first platform engines
// (Snapchat, Instagram, Facebook).
//
// Hybrid by design:
//   • ADB + Appium (over `enableAdb` → host:port) for precision inbox work
//   • DuoPlus RPA templates (`runTemplate`) for bulk chores (warmup, posting)
//
// Verified against DuoPlus API inventory (transports/cloud-phone/docs/superpowers/
// specs/duoplus-api-inventory.md). Base: https://openapi.duoplus.net · POST JSON · 1 QPS.

/** DuoPlus phone status codes. */
export type CloudPhoneStatus =
  | 0  // not configured
  | 1  // on
  | 2  // off
  | 3  // expired
  | 4  // renewal overdue
  | 10 // powering on
  | 11 // configuring
  | 12 // config failed

export interface CloudPhoneDevice {
  id: string // DuoPlus image_id
  name: string
  status: CloudPhoneStatus
  groups?: { id: string; name: string }[]
  proxy?: { id?: string; ip?: string; country?: string } | null
  /** Present after enableAdb(): the reachable ADB endpoint for Appium/adb connect. */
  adb?: { host: string; port: number } | null
  device?: { manufacturer?: string; model?: string; androidId?: string; imei?: string }
}

export interface AdbResult {
  success: boolean
  content: string
  message?: string
}

export interface CloudSms {
  message: string
  code?: string // DuoPlus parses the verification code out
  receivedAt: string
}

export interface CloudPhoneTransport {
  // ── device pool ──────────────────────────────────────────────
  listDevices(opts?: { groupId?: string; page?: number }): Promise<CloudPhoneDevice[]>
  getDevice(deviceId: string): Promise<CloudPhoneDevice>
  powerOn(deviceIds: string[]): Promise<void>
  powerOff(deviceIds: string[]): Promise<void>
  restart(deviceIds: string[]): Promise<void>

  // ── raw automation (precision: ADB + Appium) ─────────────────
  /** Enable ADB; the reachable host:port then appears on the device (listDevices). */
  enableAdb(deviceIds: string[]): Promise<void>
  disableAdb(deviceIds: string[]): Promise<void>
  /** Run an ADB shell command (no "adb shell" prefix). ≤10s, ≤20 devices upstream. */
  adb(deviceId: string, command: string): Promise<AdbResult>
  /** UIAutomator dump of the current screen as XML (DuoPlusDumpUI).
   *  Note: apps like Instagram/Snapchat render custom views and expose an EMPTY
   *  tree here — use screenshot()+vision for those. */
  dumpUi(deviceId: string): Promise<string>
  /** PNG screenshot of the current screen (screencap). Foundation for vision-based
   *  ("computer use") automation of apps that don't expose a UI tree. */
  screenshot(deviceId: string): Promise<Uint8Array>

  // ── apps ─────────────────────────────────────────────────────
  installApp(deviceIds: string[], appId: string, appVersionId?: string): Promise<void>
  startApp(deviceIds: string[], pkg: string): Promise<void>
  stopApp(deviceIds: string[], pkg: string): Promise<void>
  installedApps(deviceId: string): Promise<string[]>

  // ── account onboarding (SMS verification) ────────────────────
  listSms(numberId: string): Promise<CloudSms[]>

  // ── media push ───────────────────────────────────────────────
  pushMedia(deviceIds: string[], fileIds: string[], destDir: string): Promise<void>

  // ── isolation ────────────────────────────────────────────────
  assignProxy(deviceId: string, proxyId: string): Promise<void>

  // ── bulk automation (DuoPlus RPA templates) ──────────────────
  runTemplate(opts: {
    templateId: string
    templateType: number
    name: string
    deviceIds: string[]
    config?: unknown
  }): Promise<{ taskId?: string }>
}
