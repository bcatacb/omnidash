import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { makeCaller, UpstreamError, HttpStatusError } from "../src/core";
import { loadConfig } from "../src/config";

function makeCallerFor(baseUrl: string) {
  return makeCaller(loadConfig({ DUOPLUS_BASE_URL: baseUrl } as NodeJS.ProcessEnv));
}

describe("makeCaller throttle", () => {
  let upstream: FastifyInstance; let baseUrl: string;
  beforeEach(async () => {
    upstream = Fastify();
    upstream.post("/ok", async () => ({ code: 200, message: "ok", data: { n: 1 } }));
    await upstream.listen({ port: 0 });
    const addr = upstream.server.address();
    baseUrl = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterEach(async () => { await upstream.close(); });

  it("spaces two calls to the same path >= ~1000ms apart", async () => {
    const call = makeCallerFor(baseUrl);
    const start = Date.now();
    await call("/ok");
    await call("/ok");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(1000);
  });
});

describe("makeCaller error handling", () => {
  let upstream: FastifyInstance; let baseUrl: string;
  afterEach(async () => { await upstream.close(); });
  async function start(handler: (app: FastifyInstance) => void) {
    upstream = Fastify();
    handler(upstream);
    await upstream.listen({ port: 0 });
    const addr = upstream.server.address();
    baseUrl = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
  }

  it("rejects with UpstreamError on a non-200 envelope", async () => {
    await start((app) => app.post("/bad", async () => ({ code: 401, message: "bad key", data: null })));
    const call = makeCallerFor(baseUrl);
    await expect(call("/bad")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("rejects with HttpStatusError on a 500 HTTP response", async () => {
    await start((app) => app.post("/boom", async (_req, reply) => reply.status(500).send("kaboom")));
    const call = makeCallerFor(baseUrl);
    await expect(call("/boom")).rejects.toBeInstanceOf(HttpStatusError);
  });
});

describe("makeCaller 429 retry/backoff", () => {
  let upstream: FastifyInstance; let baseUrl: string;
  const prevBackoff = process.env.RETRY_BACKOFF_MS;
  beforeEach(() => { process.env.RETRY_BACKOFF_MS = "5"; }); // tiny backoff; throttle still spaces calls
  afterEach(async () => {
    if (prevBackoff === undefined) delete process.env.RETRY_BACKOFF_MS; else process.env.RETRY_BACKOFF_MS = prevBackoff;
    await upstream.close();
  });
  async function start(handler: (app: FastifyInstance) => void) {
    upstream = Fastify();
    handler(upstream);
    await upstream.listen({ port: 0 });
    const addr = upstream.server.address();
    baseUrl = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
  }

  it("retries past transient 429s and eventually resolves", async () => {
    let hits = 0;
    await start((app) => app.post("/flaky", async (_req, reply) => {
      hits++;
      if (hits <= 2) return reply.status(429).send("slow down");
      return { code: 200, message: "ok", data: { n: 1 } };
    }));
    const call = makeCallerFor(baseUrl);
    await expect(call<{ n: number }>("/flaky")).resolves.toEqual({ n: 1 });
    expect(hits).toBe(3);
  }, 15000);

  it("gives up with HttpStatusError(429) when upstream always 429s", async () => {
    await start((app) => app.post("/always429", async (_req, reply) => reply.status(429).send("nope")));
    const call = makeCallerFor(baseUrl);
    const err = await call("/always429").catch((e) => e);
    expect(err).toBeInstanceOf(HttpStatusError);
    expect((err as HttpStatusError).status).toBe(429);
  }, 15000);
});
