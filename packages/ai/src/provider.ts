// LLM provider abstraction — keeps the AI assist independent of any one model.
// Implementations: Cloudflare Workers AI (your account), or any OpenAI-compatible
// endpoint (OpenAI, OpenRouter, local, etc.). The plan's "AI brain" plugs in here.

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMOptions {
  temperature?: number
  maxTokens?: number
  /** Ask for strict JSON output (used by triage). */
  json?: boolean
}

export interface LLMProvider {
  readonly name: string
  chat(messages: LLMMessage[], opts?: LLMOptions): Promise<string>
}

/** Any OpenAI-compatible /chat/completions endpoint. */
export class OpenAICompatProvider implements LLMProvider {
  readonly name: string
  constructor(
    private cfg: {
      baseUrl: string // e.g. https://api.openai.com/v1
      apiKey: string
      model: string
      name?: string
      fetch?: typeof fetch
    }
  ) {
    this.name = cfg.name ?? `openai-compat:${cfg.model}`
  }

  async chat(messages: LLMMessage[], opts: LLMOptions = {}): Promise<string> {
    const f = this.cfg.fetch ?? globalThis.fetch
    const res = await f(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 600,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    if (!res.ok) throw new Error(`LLM ${this.name} -> ${res.status} ${(await res.text()).slice(0, 200)}`)
    const data: any = await res.json()
    return data?.choices?.[0]?.message?.content ?? ''
  }
}

/**
 * Cloudflare Workers AI via its OpenAI-compatible endpoint:
 *   https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1
 * Token = a CF API token with Workers AI access. Model e.g. "@cf/meta/llama-3.1-8b-instruct".
 */
export function cloudflareWorkersAI(cfg: {
  accountId: string
  apiToken: string
  model?: string
  fetch?: typeof fetch
}): LLMProvider {
  return new OpenAICompatProvider({
    baseUrl: `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai/v1`,
    apiKey: cfg.apiToken,
    model: cfg.model ?? '@cf/meta/llama-3.1-8b-instruct',
    name: 'cloudflare-workers-ai',
    fetch: cfg.fetch,
  })
}
