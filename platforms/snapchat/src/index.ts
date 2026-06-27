// Snapchat platform engine (PILOT).
//
// Drives the REAL Snapchat app on a DuoPlus cloud phone via @omnibox/cloud-phone,
// and exposes it through the standard PlatformTransformer contract so it flows into
// the unified inbox like every other platform.
//
// The orchestration here is real and complete (launch app → dump screen → act →
// normalize). The Snapchat-specific ELEMENT SELECTORS are marked `CALIBRATE:` —
// they must be confirmed against a live device (run `dumpUi` on a logged-in phone
// and read the resource-ids). See CALIBRATION.md.

import type {
  PlatformTransformer,
  PlatformCharacteristics,
  OmniAccount,
  OmniConversation,
  OmniMessage,
} from '@omnibox/core'
import { CloudPhoneClient, UiAutomator, type UiNode } from '@omnibox/cloud-phone'

export const SNAPCHAT_PKG = 'com.snapchat.android'

/** One Snapchat account == one cloud phone that's logged into it. */
export interface SnapAccount {
  id: string // operator's account id
  deviceId: string // DuoPlus image_id of the phone logged into this account
  label: string
  username: string
}

// CALIBRATE: resource-ids differ by Snapchat version — confirm via a live dumpUi.
const SEL = {
  chatTabDesc: 'Chat', // bottom-nav "Chat" tab (content-desc)
  conversationRow: 'com.snapchat.android:id/ttc', // CALIBRATE: chat list row container
  peerName: 'com.snapchat.android:id/conversation_title', // CALIBRATE
  preview: 'com.snapchat.android:id/conversation_preview', // CALIBRATE
  messageRow: 'com.snapchat.android:id/message_text', // CALIBRATE
  composeInput: 'com.snapchat.android:id/chat_input_text_field', // CALIBRATE
  sendButton: 'com.snapchat.android:id/send_button', // CALIBRATE
}

const convId = (accountId: string, peerId: string) => `snapchat:${accountId}:${peerId}`
const parsePeer = (cid: string) => cid.split(':').slice(2).join(':')
const accountOf = (cid: string) => cid.split(':')[1]

export class SnapchatEngine implements PlatformTransformer {
  readonly platform = 'snapchat' as const
  private cp: CloudPhoneClient
  private accounts: SnapAccount[]

  constructor(opts: { proxyUrl: string; consoleToken?: string; accounts: SnapAccount[] }) {
    this.cp = new CloudPhoneClient({ baseUrl: opts.proxyUrl, consoleToken: opts.consoleToken })
    this.accounts = opts.accounts
  }

  getCharacteristics(): PlatformCharacteristics {
    return { transport: 'cloud-phone', supportsRealtime: false, typicalSendLatencyMs: 4000 }
  }

  private ui(deviceId: string) {
    return new UiAutomator(this.cp, deviceId)
  }

  private deviceFor(accountId: string): string {
    const a = this.accounts.find((x) => x.id === accountId)
    if (!a) throw new Error(`snapchat: no device mapped for account ${accountId}`)
    return a.deviceId
  }

  /** Make sure Snapchat is open and on the Chat tab. */
  private async openChats(deviceId: string): Promise<UiAutomator> {
    await this.cp.startApp([deviceId], SNAPCHAT_PKG)
    const ui = this.ui(deviceId)
    const tab = await ui.waitFor((n) => n.contentDesc.includes(SEL.chatTabDesc) || n.text === 'Chat', 12000)
    if (tab) await ui.tapNode(tab)
    return ui
  }

  async listAccounts(): Promise<OmniAccount[]> {
    return this.accounts.map((a) => ({
      id: a.id,
      platform: 'snapchat',
      label: a.label,
      username: a.username,
      status: 'connected',
    }))
  }

  async listConversations(opts?: { accountIds?: string[] }): Promise<OmniConversation[]> {
    const accts = this.accounts.filter((a) => !opts?.accountIds || opts.accountIds.includes(a.id))
    const out: OmniConversation[] = []
    for (const a of accts) {
      try {
        const ui = await this.openChats(a.deviceId)
        const nodes = await ui.snapshot()
        // CALIBRATE: group nodes into rows by the conversation-row container; here we
        // pair each peer-name node with the nearest preview node beneath it.
        const names = nodes.filter((n) => n.resourceId === SEL.peerName)
        for (const nameNode of names) {
          const peer = nameNode.text || 'Snap user'
          const preview = nearestBelow(nodes, nameNode, SEL.preview)
          out.push({
            id: convId(a.id, peer),
            platform: 'snapchat',
            accountId: a.id,
            peer: { id: peer, displayName: peer },
            lastMessagePreview: preview?.text ?? null,
            lastMessageAt: null, // CALIBRATE: Snapchat shows relative time; parse if a timestamp node exists
            lastMessageDirection: null,
            unreadCount: 0, // CALIBRATE: detect the unread dot
            archived: false,
            meta: { deviceId: a.deviceId },
          })
        }
      } catch (e) {
        console.warn(`[snapchat] listConversations failed for ${a.id}:`, e)
      }
    }
    return out
  }

  async getMessages(cid: string): Promise<OmniMessage[]> {
    const deviceId = this.deviceFor(accountOf(cid))
    const peer = parsePeer(cid)
    const ui = await this.openChats(deviceId)
    const row = await ui.waitFor((n) => n.text === peer || n.text.includes(peer), 8000)
    if (!row) return []
    await ui.tapNode(row)
    const nodes = await ui.snapshot()
    // CALIBRATE: distinguish inbound vs outbound (bounds.x side / row container id).
    return nodes
      .filter((n) => n.resourceId === SEL.messageRow && n.text)
      .map((n, i): OmniMessage => ({
        id: `${cid}:${i}`,
        conversationId: cid,
        platform: 'snapchat',
        direction: n.bounds.x1 > 0 ? 'in' : 'in', // CALIBRATE: side-based in/out
        body: n.text,
        sentAt: new Date().toISOString(), // CALIBRATE: no reliable per-message timestamp in UI
      }))
  }

  async sendMessage(cid: string, body: string): Promise<OmniMessage> {
    const deviceId = this.deviceFor(accountOf(cid))
    const peer = parsePeer(cid)
    const ui = await this.openChats(deviceId)
    const row = await ui.waitFor((n) => n.text === peer || n.text.includes(peer), 8000)
    if (!row) throw new Error(`snapchat: conversation with ${peer} not found`)
    await ui.tapNode(row)
    const input = await ui.waitFor((n) => n.resourceId === SEL.composeInput, 8000)
    if (!input) throw new Error('snapchat: compose input not found (CALIBRATE composeInput)')
    await ui.tapNode(input)
    await ui.type(body)
    const send = (await ui.snapshot()).find((n) => n.resourceId === SEL.sendButton)
    if (send) await ui.tapNode(send)
    else await ui.enter()
    return {
      id: `${cid}:${Date.now()}`,
      conversationId: cid,
      platform: 'snapchat',
      direction: 'out',
      body,
      sentAt: new Date().toISOString(),
    }
  }

  async markRead(): Promise<void> {
    // Opening a chat marks it read on Snapchat; no separate action needed.
  }

  async archiveConversation(): Promise<void> {
    // CALIBRATE: long-press row → "Archive" if/where Snapchat supports it.
  }

  async startConversation(
    accountId: string,
    peer: { displayName: string; username?: string; id?: string }
  ): Promise<OmniConversation> {
    const peerId = peer.username || peer.id || peer.displayName
    return {
      id: convId(accountId, peerId),
      platform: 'snapchat',
      accountId,
      peer: { id: peerId, displayName: peer.displayName, username: peer.username },
      lastMessagePreview: null,
      lastMessageAt: null,
      lastMessageDirection: null,
      unreadCount: 0,
      archived: false,
    }
  }
}

/** Find the node with `resId` whose top edge is just below `ref` (same column-ish). */
function nearestBelow(nodes: UiNode[], ref: UiNode, resId: string): UiNode | undefined {
  return nodes
    .filter((n) => n.resourceId === resId && n.bounds.y1 >= ref.bounds.y1)
    .sort((a, b) => a.bounds.y1 - b.bounds.y1)[0]
}
