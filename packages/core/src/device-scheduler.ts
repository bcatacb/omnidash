// DeviceScheduler — serializes cloud-phone usage to the plan's concurrency limit.
//
// DuoPlus (current plan) allows only ONE phone mounted at a time across the whole
// fleet. So all cloud-phone work must take turns through a single "slot": mount a
// phone → do that account's work → power it down → next account. This scheduler
// enforces that, and the limit is configurable so it scales if the plan grows.
//
// This is the natural home for the Cloudflare Queues/Durable-Objects coordination
// later: the queue feeds accounts in, the scheduler leases the slot.

import type { CloudPhoneTransport } from './cloud-phone'

export interface DeviceSchedulerOptions {
  /** Max phones mounted at once. DuoPlus single-slot plan = 1. */
  concurrency?: number
  /** Power the phone off when the lease releases, to free the slot. Default true. */
  powerOffOnRelease?: boolean
  /** How long to wait for a phone to reach mounted/on (status 1) after powerOn. */
  mountTimeoutMs?: number
  /** Poll interval while waiting to mount. */
  pollMs?: number
}

export class DeviceScheduler {
  private slots: number
  private active = 0
  private waiters: Array<() => void> = []

  constructor(private cp: CloudPhoneTransport, private opts: DeviceSchedulerOptions = {}) {
    this.slots = Math.max(1, opts.concurrency ?? 1)
  }

  private acquire(): Promise<void> {
    if (this.active < this.slots) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) next()
    else this.active--
  }

  /**
   * Mount one phone, run `fn` while it's live, then power it down — never exceeding
   * the concurrency limit. Work for other accounts queues until the slot frees.
   */
  async withDevice<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      await this.cp.powerOn([deviceId])
      await this.waitMountable(deviceId)
      return await fn()
    } finally {
      if (this.opts.powerOffOnRelease !== false) {
        try {
          await this.cp.powerOff([deviceId])
        } catch {
          /* best-effort: don't let teardown failure mask the result */
        }
      }
      this.release()
    }
  }

  /** Run work across many devices, automatically serialized to the concurrency limit. */
  async forEachDevice<T>(
    deviceIds: string[],
    fn: (deviceId: string) => Promise<T>
  ): Promise<Array<{ deviceId: string; result?: T; error?: string }>> {
    return Promise.all(
      deviceIds.map((id) =>
        this.withDevice(id, () => fn(id))
          .then((result) => ({ deviceId: id, result }))
          .catch((e) => ({ deviceId: id, error: e instanceof Error ? e.message : String(e) }))
      )
    )
  }

  private async waitMountable(deviceId: string): Promise<void> {
    const timeout = this.opts.mountTimeoutMs ?? 90_000
    const poll = this.opts.pollMs ?? 3_000
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const d = await this.cp.getDevice(deviceId)
      if (d.status === 1) return // on / mounted
      await new Promise((r) => setTimeout(r, poll))
    }
    throw new Error(`device ${deviceId} did not mount within ${timeout}ms (concurrency slot or balance?)`)
  }
}
