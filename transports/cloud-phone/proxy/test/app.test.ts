import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

function fakeUpstream(): FastifyInstance {
  const app = Fastify();
  const phones = [
    { id: "a", name: "A", status: 1, os: "Android 15", size: "8G", created_at: "1", expired_at: "2", ip: "1.1.1.1", area: "US", remark: "secret", adb: "1.2.3.4:5", adb_password: "", group: [{ id: "g1", name: "Pool" }] },
    { id: "b", name: "B", status: 2, os: "Android 14", size: "8G", created_at: "1", expired_at: "2", ip: "1.1.1.2", area: "US", remark: "", adb: "", adb_password: "", group: [] },
  ];
  app.post("/api/v1/cloudPhone/list", async (req) => {
    const body = req.body as { page: number; pagesize: number };
    return { code: 200, message: "Success", data: { list: phones, page: body.page, pagesize: body.pagesize, total: 2, total_page: 1 } };
  });
  app.post("/api/v1/cloudPhone/powerOff", async (req) => {
    const body = req.body as { image_ids: string[] };
    return { code: 200, message: "Success", data: { success: body.image_ids, fail: [] } };
  });
  app.post("/api/v1/cloudPhone/badkey", async (_req, reply) => reply.status(401).send("nope"));
  return app;
}

describe("proxy /api against real-shaped upstream", () => {
  let upstream: FastifyInstance; let baseUrl: string;
  beforeEach(async () => {
    upstream = fakeUpstream();
    await upstream.listen({ port: 0 });
    const addr = upstream.server.address();
    baseUrl = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterEach(async () => { await upstream.close(); });

  it("GET /api/phones maps real list to clean phones", async () => {
    const app = buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl } as NodeJS.ProcessEnv));
    const res = await app.inject({ method: "GET", url: "/api/phones?page=1&pageSize=20" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items[0]).toMatchObject({ id: "a", powerState: "on", group: "Pool", os: "Android 15" });
    expect(body.items[1].powerState).toBe("off");
  });

  it("POST /api/phones/power off maps success/fail to results", async () => {
    const app = buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl } as NodeJS.ProcessEnv));
    const res = await app.inject({ method: "POST", url: "/api/phones/power", payload: { ids: ["a", "b"], action: "off" } });
    expect(res.json().results).toEqual([{ id: "a", ok: true }, { id: "b", ok: true }]);
  });

});

function errorUpstream(status: number, message: string): FastifyInstance {
  const app = Fastify();
  app.post("/api/v1/cloudPhone/list", async (_req, reply) => reply.status(status).send(message));
  return app;
}

describe("proxy /api surfaces upstream HTTP errors", () => {
  let upstream: FastifyInstance; let baseUrl: string;
  async function startUpstream(status: number, message: string) {
    upstream = errorUpstream(status, message);
    await upstream.listen({ port: 0 });
    const addr = upstream.server.address();
    baseUrl = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
  }
  afterEach(async () => { await upstream.close(); });

  it("surfaces upstream 401 distinctly", async () => {
    await startUpstream(401, "bad key");
    const app = buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl } as NodeJS.ProcessEnv));
    const res = await app.inject({ method: "GET", url: "/api/phones?page=1&pageSize=20" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/unauthorized/);
  });

  it("surfaces upstream 429 distinctly", async () => {
    // The proxy now retries 429s with backoff before surfacing; this walks the
    // full retry path (per-path throttle ~1.1s/attempt), so allow extra time.
    await startUpstream(429, "slow down");
    const app = buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl } as NodeJS.ProcessEnv));
    const res = await app.inject({ method: "GET", url: "/api/phones?page=1&pageSize=20" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatch(/rate limited/);
  }, 15000);
});
