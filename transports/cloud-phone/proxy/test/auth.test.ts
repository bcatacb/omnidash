import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

function fakeUpstream(): FastifyInstance {
  const app = Fastify();
  app.post("/api/v1/cloudPhone/list", async (req) => {
    const body = req.body as { page: number; pagesize: number };
    return { code: 200, message: "Success", data: { list: [], page: body.page, pagesize: body.pagesize, total: 0, total_page: 0 } };
  });
  return app;
}

describe("console-token auth gate", () => {
  let upstream: FastifyInstance; let baseUrl: string;
  beforeEach(async () => {
    upstream = fakeUpstream();
    await upstream.listen({ port: 0 });
    const addr = upstream.server.address();
    baseUrl = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterEach(async () => { await upstream.close(); });

  it("rejects /api without the header when CONSOLE_TOKEN is set", async () => {
    const app = buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl, CONSOLE_TOKEN: "s3cret" } as NodeJS.ProcessEnv));
    const res = await app.inject({ method: "GET", url: "/api/phones?page=1&pageSize=20" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/console token/);
  });

  it("allows /api with the correct header when CONSOLE_TOKEN is set", async () => {
    const app = buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl, CONSOLE_TOKEN: "s3cret" } as NodeJS.ProcessEnv));
    const res = await app.inject({ method: "GET", url: "/api/phones?page=1&pageSize=20", headers: { "x-console-token": "s3cret" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
  });

  it("serves /health without a token even when CONSOLE_TOKEN is set", async () => {
    const app = buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl, CONSOLE_TOKEN: "s3cret" } as NodeJS.ProcessEnv));
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("does not gate /api when no token is configured", async () => {
    const app = buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl } as NodeJS.ProcessEnv));
    const res = await app.inject({ method: "GET", url: "/api/phones?page=1&pageSize=20" });
    expect(res.statusCode).toBe(200);
  });
});
