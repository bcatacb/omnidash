// OmniBox AI API — thin server-side endpoint over Cloudflare Workers AI.
// Holds the Workers AI token server-side (never the browser). Mirrors the logic in
// @omnibox/ai (InboxAssistant); kept dependency-free so it deploys as a single file.
//
// Routes (POST JSON):
//   /draft     { conversation, messages, persona?, goal?, language? } -> { text }
//   /triage    { conversation, messages }                            -> { label, confidence, reason }
//   /translate { text, toLang? }                                     -> { text }
//   /health    (GET)                                                 -> { ok, model }
//
// Env: WORKERS_AI_TOKEN, CF_ACCOUNT_ID, AI_MODEL?, PORT?

import http from 'node:http'

const TOKEN = process.env.WORKERS_AI_TOKEN || ''
const ACCT = process.env.CF_ACCOUNT_ID || ''
const MODEL = process.env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const PORT = Number(process.env.PORT || 8787)
const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/v1/chat/completions`

async function chat(messages, { temperature = 0.4, maxTokens = 600, json = false } = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  })
  if (!res.ok) throw new Error(`workers-ai ${res.status} ${(await res.text()).slice(0, 200)}`)
  const d = await res.json()
  return d?.choices?.[0]?.message?.content ?? ''
}

const transcript = (conv = {}, msgs = [], max = 20) => {
  const peer = conv?.peer?.displayName || conv?.peer?.username || 'Them'
  return (msgs || [])
    .slice(-max)
    .map((m) => `${m.direction === 'out' ? 'Me' : peer}: ${m.body ?? ''}`)
    .join('\n')
}

async function draft(b = {}) {
  const conv = b.conversation || {}
  const sys = [
    "You draft the operator's next reply in a 1:1 chat.",
    b.persona ? `Voice/persona: ${b.persona}` : 'Voice: natural, concise, human, friendly.',
    b.goal ? `Goal: ${b.goal}` : '',
    b.language ? `Write in: ${b.language}.` : 'Reply in the same language the other person is using.',
    'Output ONLY the reply text — no quotes, no preamble.',
  ].filter(Boolean).join('\n')
  const user = `Platform ${conv.platform}. Other person: ${conv?.peer?.displayName}.\nThread:\n${transcript(conv, b.messages)}\n\nDraft my next reply.`
  return { text: (await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.6 })).trim() }
}

async function triage(b = {}) {
  const conv = b.conversation || {}
  const sys =
    'You triage 1:1 outreach conversations. Reply with ONLY a JSON object (no prose, no code fences): ' +
    '{"label": one of ["interested","needs_reply","not_interested","spam","other"], "confidence": number 0..1, "reason": short string}.'
  const user = `Platform ${conv.platform}, with ${conv?.peer?.displayName}:\n${transcript(conv, b.messages)}\n\nClassify the latest state.`
  const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0 })
  const m = raw.match(/\{[\s\S]*\}/)
  try {
    const j = JSON.parse(m ? m[0] : raw)
    return { label: j.label || 'other', confidence: Number(j.confidence) || 0, reason: String(j.reason || '') }
  } catch {
    return { label: 'other', confidence: 0, reason: `parse-failed: ${raw.slice(0, 100)}` }
  }
}

async function translate(b = {}) {
  const to = b.toLang || 'English'
  const out = await chat(
    [{ role: 'system', content: `Translate to ${to}. Output only the translation.` }, { role: 'user', content: String(b.text || '') }],
    { temperature: 0 }
  )
  return { text: out.trim() }
}

const ROUTES = { '/draft': draft, '/triage': triage, '/translate': translate }

http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    const path = (req.url || '').replace(/\/$/, '') || '/'
    if (path === '/health') {
      res.end(JSON.stringify({ ok: true, model: MODEL, configured: !!(TOKEN && ACCT) }))
      return
    }
    const fn = ROUTES[path]
    if (req.method !== 'POST' || !fn) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      try {
        const out = await fn(body ? JSON.parse(body) : {})
        res.end(JSON.stringify(out))
      } catch (e) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(e?.message || e) }))
      }
    })
  })
  .listen(PORT, () => console.log(`[ai-api] listening on :${PORT} model=${MODEL} configured=${!!(TOKEN && ACCT)}`))
