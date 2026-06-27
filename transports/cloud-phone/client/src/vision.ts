// VisionAutomator — "computer use" loop for apps that don't expose a UI tree
// (Instagram, Snapchat, TikTok render custom views → uiautomator is empty).
//
// Loop: screenshot → a VisionDriver (OCR or a vision LLM) decides the next action
// → we execute it via ADB `input` → repeat until the goal is done.
//
// The VisionDriver is pluggable — the natural implementation is a vision model
// (Cloudflare Workers AI / Claude) that reads the screenshot and returns coordinates.
// That's the bridge from "the AI brain" to actually operating the phones.

import type { CloudPhoneTransport } from '@omnibox/core'

export interface VisionAction {
  type: 'tap' | 'swipe' | 'type' | 'key' | 'back' | 'wait' | 'done'
  x?: number
  y?: number
  x2?: number
  y2?: number
  text?: string
  code?: number
  ms?: number
  /** Optional model rationale / extracted data for logging + the unified inbox. */
  note?: string
}

export interface VisionContext {
  /** Screen size, so the driver can return absolute coordinates. */
  width?: number
  height?: number
  /** Arbitrary state the engine threads through the loop (e.g. collected messages). */
  scratch?: Record<string, unknown>
}

export interface VisionDriver {
  /**
   * Given the current screenshot (PNG bytes) and a goal, decide the next action.
   * Implementations: a vision LLM (Workers AI / Claude computer-use) or an OCR+rules engine.
   */
  next(png: Uint8Array, goal: string, ctx: VisionContext): Promise<VisionAction>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class VisionAutomator {
  constructor(
    private cp: CloudPhoneTransport,
    private deviceId: string,
    private driver: VisionDriver
  ) {}

  screenshot(): Promise<Uint8Array> {
    return this.cp.screenshot(this.deviceId)
  }

  /** Execute a single decided action against the device. */
  async act(a: VisionAction): Promise<void> {
    switch (a.type) {
      case 'tap':
        await this.cp.adb(this.deviceId, `input tap ${a.x} ${a.y}`)
        break
      case 'swipe':
        await this.cp.adb(this.deviceId, `input swipe ${a.x} ${a.y} ${a.x2} ${a.y2} ${a.ms ?? 300}`)
        break
      case 'type': {
        const safe = (a.text ?? '').replace(/ /g, '%s').replace(/(["'`$&|;<>()])/g, '\\$1')
        await this.cp.adb(this.deviceId, `input text ${safe}`)
        break
      }
      case 'key':
        await this.cp.adb(this.deviceId, `input keyevent ${a.code}`)
        break
      case 'back':
        await this.cp.adb(this.deviceId, `input keyevent 4`)
        break
      case 'wait':
        await sleep(a.ms ?? 1000)
        break
      case 'done':
        break
    }
  }

  /**
   * Pursue a goal: screenshot → driver decides → act, until `done` or maxSteps.
   * Returns the action trail (useful for debugging + feeding extracted data onward).
   */
  async pursue(goal: string, ctx: VisionContext = {}, maxSteps = 15): Promise<VisionAction[]> {
    const trail: VisionAction[] = []
    for (let i = 0; i < maxSteps; i++) {
      const png = await this.screenshot()
      const action = await this.driver.next(png, goal, ctx)
      trail.push(action)
      if (action.type === 'done') break
      await this.act(action)
      await sleep(action.type === 'wait' ? 0 : 700) // let the UI settle between actions
    }
    return trail
  }
}
