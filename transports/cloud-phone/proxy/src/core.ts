import type { FastifyInstance } from "fastify";
import { type ProxyConfig, authHeaders } from "./config.js";

const MIN_INTERVAL_MS = 1100; // honor 1 QPS per endpoint
const MAX_429_RETRIES = 3;
// Base backoff for upstream 429s. Read lazily + env-overridable so tests run fast.
function retryBackoffMs(): number { return Number(process.env.RETRY_BACKOFF_MS ?? "200"); }

export interface Envelope<T> { code: number; message: string; data: T; }

export class UpstreamError extends Error {
  constructor(public code: number, public upstreamMsg: string) { super(`upstream code ${code}: ${upstreamMsg}`); }
}
export class HttpStatusError extends Error {
  constructor(public status: number, public bodyText: string) { super(`upstream HTTP ${status}`); }
}

export type Caller = <T>(path: string, body?: unknown) => Promise<T>;

export function makeCaller(cfg: ProxyConfig): Caller {
  const lastCall = new Map<string, number>();

  async function throttle(path: string) {
    const now = Date.now();
    const prev = lastCall.get(path) ?? 0;
    const wait = prev + MIN_INTERVAL_MS - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall.set(path, Date.now());
  }

  return async function call<T>(path: string, body?: unknown): Promise<T> {
    // Retry on upstream 429 with exponential backoff before giving up.
    for (let attempt = 0; ; attempt++) {
      await throttle(path);
      const res = await fetch(`${cfg.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Lang: "en", ...authHeaders(cfg) },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        let text = "";
        try { text = await res.text(); } catch { /* ignore */ }
        if (res.status === 429 && attempt < MAX_429_RETRIES) {
          const wait = retryBackoffMs() * 2 ** attempt; // 200, 400, 800ms (base configurable)
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw new HttpStatusError(res.status, text);
      }
      const env = (await res.json()) as Envelope<T>;
      if (env.code !== 200) throw new UpstreamError(env.code, env.message);
      return env.data;
    }
  };
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpStatusError) {
      if (err.status === 401) return reply.status(401).send({ error: "unauthorized: check DUOPLUS_API_KEY" });
      if (err.status === 429) return reply.status(429).send({ error: "rate limited by upstream" });
      return reply.status(502).send({ error: "upstream HTTP error", upstreamStatus: err.status });
    }
    if (err instanceof UpstreamError) {
      return reply.status(502).send({ error: "upstream error", upstreamCode: err.code, upstreamMsg: err.upstreamMsg });
    }
    return reply.status(500).send({ error: err.message });
  });
}
