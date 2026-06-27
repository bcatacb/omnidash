import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

function fakeUpstream(): { app: FastifyInstance; calls: Record<string, unknown> } {
  const app = Fastify();
  const calls: Record<string, unknown> = {};

  app.post("/api/v1/cloudPhone/purchase", async (req) => {
    calls["cloudPhone/purchase"] = req.body;
    return { code: 200, message: "Success", data: { order_id: "ord_x" } };
  });
  app.post("/api/v1/cloudPhone/renewal", async (req) => {
    calls["cloudPhone/renewal"] = req.body;
    return { code: 200, message: "Success", data: { order_id: "ord_y" } };
  });
  app.post("/api/v1/cloudPhone/update", async (req) => {
    calls["cloudPhone/update"] = req.body;
    return { code: 200, message: "Success", data: { success: ["cp-1"], fail: [], fail_reason: {} } };
  });

  return { app, calls };
}

describe("proxy provision routes", () => {
  let upstream: FastifyInstance; let baseUrl: string; let calls: Record<string, unknown>;
  beforeEach(async () => {
    const u = fakeUpstream();
    upstream = u.app; calls = u.calls;
    await upstream.listen({ port: 0 });
    const addr = upstream.server.address();
    baseUrl = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterEach(async () => { await upstream.close(); });

  function makeApp() {
    return buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl } as NodeJS.ProcessEnv));
  }

  it("POST buy forwards {os,duration,quantity}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/phones/buy", payload: { os: "15", duration: 30, quantity: 2 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ order_id: "ord_x" });
    expect(calls["cloudPhone/purchase"]).toMatchObject({ os: "15", duration: 30, quantity: 2 });
  });

  it("POST renew forwards {image_ids,duration}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/phones/renew", payload: { image_ids: ["cp-1"], duration: 90 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ order_id: "ord_y" });
    expect(calls["cloudPhone/renewal"]).toMatchObject({ image_ids: ["cp-1"], duration: 90 });
  });

  it("POST modify forwards {images}", async () => {
    const images = [{ image_id: "cp-1", name: "New", remark: "r" }];
    const res = await makeApp().inject({ method: "POST", url: "/api/phones/modify", payload: { images } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: ["cp-1"] });
    expect(calls["cloudPhone/update"]).toMatchObject({ images });
  });
});
