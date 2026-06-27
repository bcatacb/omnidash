// InboxAssistant — the AI layer over the unified inbox: triage conversations,
// draft replies, translate. Works on the canonical Omni* types, so it's identical
// across Telegram, Discord, TikTok (and the rest). Model-agnostic via LLMProvider.

import type { OmniConversation, OmniMessage } from '@omnibox/core'
import type { LLMProvider } from './provider'

export type TriageLabel = 'interested' | 'needs_reply' | 'not_interested' | 'spam' | 'other'

export interface TriageResult {
  label: TriageLabel
  confidence: number
  reason: string
}

export interface AssistantOptions {
  /** Operator persona / brand voice for drafted replies. */
  persona?: string
  /** What replies should aim to achieve. */
  goal?: string
  /** Force a reply language; default = match the other person. */
  language?: string
}

function transcript(conv: OmniConversation, messages: OmniMessage[], max = 20): string {
  const peer = conv.peer.displayName || conv.peer.username || 'Them'
  return messages
    .slice(-max)
    .map((m) => `${m.direction === 'out' ? 'Me' : peer}: ${m.body ?? ''}`)
    .join('\n')
}

export class InboxAssistant {
  constructor(private llm: LLMProvider, private defaults: AssistantOptions = {}) {}

  /** Classify the current state of a conversation (interested / needs_reply / …). */
  async triage(conv: OmniConversation, messages: OmniMessage[]): Promise<TriageResult> {
    const sys =
      'You triage 1:1 outreach conversations. Reply ONLY with JSON: ' +
      '{"label": one of ["interested","needs_reply","not_interested","spam","other"], ' +
      '"confidence": number 0..1, "reason": short string}.'
    const user = `Platform ${conv.platform}, with ${conv.peer.displayName}:\n${transcript(conv, messages)}\n\nClassify the latest state.`
    const raw = await this.llm.chat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { json: true, temperature: 0 }
    )
    try {
      const j = JSON.parse(raw)
      return {
        label: (j.label as TriageLabel) ?? 'other',
        confidence: Number(j.confidence) || 0,
        reason: String(j.reason ?? ''),
      }
    } catch {
      return { label: 'other', confidence: 0, reason: `parse-failed: ${raw.slice(0, 120)}` }
    }
  }

  /** Draft the operator's next reply in the conversation. */
  async draftReply(
    conv: OmniConversation,
    messages: OmniMessage[],
    opts: AssistantOptions = {}
  ): Promise<{ text: string }> {
    const o = { ...this.defaults, ...opts }
    const sys = [
      "You draft the operator's next reply in a 1:1 chat.",
      o.persona ? `Voice/persona: ${o.persona}` : 'Voice: natural, concise, human, friendly.',
      o.goal ? `Goal: ${o.goal}` : '',
      o.language ? `Write in: ${o.language}.` : 'Reply in the same language the other person is using.',
      'Output ONLY the reply text — no quotes, no preamble, no sign-off unless natural.',
    ]
      .filter(Boolean)
      .join('\n')
    const user = `Platform ${conv.platform}. Other person: ${conv.peer.displayName}.\nThread:\n${transcript(conv, messages)}\n\nDraft my next reply.`
    const text = (
      await this.llm.chat([{ role: 'system', content: sys }, { role: 'user', content: user }], {
        temperature: 0.6,
      })
    ).trim()
    return { text }
  }

  /** Translate arbitrary text (e.g. inbound foreign-language messages) to a target language. */
  async translate(text: string, toLang = 'English'): Promise<{ text: string }> {
    const out = await this.llm.chat(
      [
        { role: 'system', content: `Translate the user's message to ${toLang}. Output only the translation.` },
        { role: 'user', content: text },
      ],
      { temperature: 0 }
    )
    return { text: out.trim() }
  }
}
