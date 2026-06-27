// UiAutomator — element-based Android automation over the cloud-phone ADB bridge.
// Dump the screen, find nodes by text / resource-id / content-desc, then tap/type
// via `input` ADB commands. Dependency-free XML parsing (regex over the dump).
//
// Reusable by every cloud-phone platform engine (Snapchat, Instagram, Facebook).
// For precise element work you can also `adb connect` and drive Appium directly —
// this helper covers the common "read screen → act" loop without that setup.

import type { CloudPhoneTransport } from '@omnibox/core'

export interface UiNode {
  text: string
  resourceId: string
  contentDesc: string
  className: string
  clickable: boolean
  bounds: { x1: number; y1: number; x2: number; y2: number }
}

const ATTR = (xml: string, name: string): string => {
  const m = xml.match(new RegExp(`${name}="([^"]*)"`))
  return m ? m[1] : ''
}

function parseBounds(s: string): UiNode['bounds'] | null {
  // format: [x1,y1][x2,y2]
  const m = s.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  if (!m) return null
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }
}

/** Parse a uiautomator XML dump into a flat list of nodes. */
export function parseUiDump(xml: string): UiNode[] {
  const nodes: UiNode[] = []
  const re = /<node\b[^>]*?\/?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const tag = m[0]
    const bounds = parseBounds(ATTR(tag, 'bounds'))
    if (!bounds) continue
    nodes.push({
      text: ATTR(tag, 'text'),
      resourceId: ATTR(tag, 'resource-id'),
      contentDesc: ATTR(tag, 'content-desc'),
      className: ATTR(tag, 'class'),
      clickable: ATTR(tag, 'clickable') === 'true',
      bounds,
    })
  }
  return nodes
}

export const nodeCenter = (n: UiNode) => ({
  x: Math.round((n.bounds.x1 + n.bounds.x2) / 2),
  y: Math.round((n.bounds.y1 + n.bounds.y2) / 2),
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class UiAutomator {
  constructor(private cp: CloudPhoneTransport, private deviceId: string) {}

  /** Current screen as a node list. */
  async snapshot(): Promise<UiNode[]> {
    return parseUiDump(await this.cp.dumpUi(this.deviceId))
  }

  find(nodes: UiNode[], pred: (n: UiNode) => boolean): UiNode | undefined {
    return nodes.find(pred)
  }
  byText = (nodes: UiNode[], t: string, exact = false) =>
    nodes.find((n) => (exact ? n.text === t : n.text.includes(t)))
  byResId = (nodes: UiNode[], id: string) =>
    nodes.find((n) => n.resourceId === id || n.resourceId.endsWith('/' + id))
  byDesc = (nodes: UiNode[], d: string) => nodes.find((n) => n.contentDesc.includes(d))

  async tap(x: number, y: number): Promise<void> {
    await this.cp.adb(this.deviceId, `input tap ${x} ${y}`)
  }
  async tapNode(n: UiNode): Promise<void> {
    const c = nodeCenter(n)
    await this.tap(c.x, c.y)
  }
  async swipe(x1: number, y1: number, x2: number, y2: number, ms = 300): Promise<void> {
    await this.cp.adb(this.deviceId, `input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`)
  }
  /** adb `input text` — spaces become %s; emoji/newlines need a clipboard path (TODO per platform). */
  async type(text: string): Promise<void> {
    const safe = text.replace(/ /g, '%s').replace(/(["'`$&|;<>()])/g, '\\$1')
    await this.cp.adb(this.deviceId, `input text ${safe}`)
  }
  async key(code: number): Promise<void> {
    await this.cp.adb(this.deviceId, `input keyevent ${code}`)
  }
  back = () => this.key(4)
  enter = () => this.key(66)
  home = () => this.key(3)

  /** Poll the screen until `pred` finds a node or timeout. */
  async waitFor(pred: (n: UiNode) => boolean, timeoutMs = 8000, intervalMs = 600): Promise<UiNode | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const found = (await this.snapshot()).find(pred)
      if (found) return found
      await sleep(intervalMs)
    }
    return null
  }
}
