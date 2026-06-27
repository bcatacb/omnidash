import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

function fakeUpstream(): { app: FastifyInstance; calls: Record<string, unknown> } {
  const app = Fastify();
  const calls: Record<string, unknown> = {};

  app.post("/api/v1/team/order", async (req) => {
    calls["team/order"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ type: "Cloud Phone", order_id: "ord-1", product: "Android 15", description: "30 days x 2", status: "Paid", total: "19.98", created_at: "2026-06-01 10:00:00", expired_at: "2026-07-01 10:00:00" }], page: 1, pagesize: 20, total: 1 } };
  });
  app.post("/api/v1/subscriptionStartup/list", async (req) => {
    calls["subscriptionStartup/list"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ id: "sub-1", name: "Starter", cpu: "4", ram: "8G", rom: "64G", renewal_status: 1, free_status: 1, remark: "", expired_at: "2026-07-01", created_at: "2026-06-01", need_renewal: false }], page: 1, pagesize: 20, total: 1 } };
  });
  app.post("/api/v1/subscriptionStartup/purchase", async (req) => {
    calls["subscriptionStartup/purchase"] = req.body;
    return { code: 200, message: "Success", data: { order_id: "ord-sub-1" } };
  });
  app.post("/api/v1/subscriptionStartup/renewal", async (req) => {
    calls["subscriptionStartup/renewal"] = req.body;
    return { code: 200, message: "Success", data: { order_id: "ord-sub-renew" } };
  });

  return { app, calls };
}

describe("proxy account routes", () => {
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

  it("GET orders defaults a date range when none provided", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/orders" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({ order_id: "ord-1" });
    const sent = calls["team/order"] as { created_at_start?: string; created_at_end?: string };
    expect(sent.created_at_start).toBeTruthy();
    expect(sent.created_at_end).toBeTruthy();
    expect(sent.created_at_start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    expect(sent.created_at_end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
  });

  it("GET orders forwards provided date range", async () => {
    await makeApp().inject({ method: "GET", url: "/api/orders?createdStart=2026-01-01T00:00:00%2B08:00&createdEnd=2026-02-01T00:00:00%2B08:00" });
    expect(calls["team/order"]).toMatchObject({ created_at_start: "2026-01-01T00:00:00+08:00", created_at_end: "2026-02-01T00:00:00+08:00" });
  });

  it("GET subscriptions defaults free_status=1", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/subscriptions" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({ id: "sub-1" });
    expect(calls["subscriptionStartup/list"]).toMatchObject({ free_status: 1 });
  });

  it("GET subscriptions forwards provided freeStatus", async () => {
    await makeApp().inject({ method: "GET", url: "/api/subscriptions?freeStatus=0" });
    expect(calls["subscriptionStartup/list"]).toMatchObject({ free_status: 0 });
  });

  it("POST subscriptions/purchase passes body through", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/subscriptions/purchase", payload: { duration: 30, quantity: 1 } });
    expect(res.json()).toMatchObject({ order_id: "ord-sub-1" });
    expect(calls["subscriptionStartup/purchase"]).toMatchObject({ duration: 30, quantity: 1 });
  });

  it("POST subscriptions/renew forwards {phone_ids,duration}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/subscriptions/renew", payload: { phone_ids: ["sub-1"], duration: 30 } });
    expect(res.json()).toMatchObject({ order_id: "ord-sub-renew" });
    expect(calls["subscriptionStartup/renewal"]).toMatchObject({ phone_ids: ["sub-1"], duration: 30 });
  });
});
