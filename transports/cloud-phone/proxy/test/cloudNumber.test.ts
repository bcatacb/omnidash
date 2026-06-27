import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

function fakeUpstream(): { app: FastifyInstance; calls: Record<string, unknown> } {
  const app = Fastify();
  const calls: Record<string, unknown> = {};

  app.post("/api/v1/cloudNumber/numberList", async (req) => {
    calls["cloudNumber/numberList"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ id: "num-1", phone_number: "+15551230001", region_name: "United States", type_name: "Mobile", status_name: "On", renewal_status: 1, remark: "", created_at: "2026-06-01 10:00:00", expired_at: "2026-07-01 10:00:00" }], page: 1, pagesize: 20, total: 1 } };
  });
  app.post("/api/v1/cloudNumber/smsList", async (req) => {
    calls["cloudNumber/smsList"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ message: "Your code is 123456", code: "123456", received_at: "2026-06-10 12:00:00" }], page: 1, pagesize: 20, total: 1 } };
  });
  app.post("/api/v1/cloudNumber/package", async (req) => {
    calls["cloudNumber/package"] = req.body;
    return { code: 200, message: "Success", data: { duration: ["30", "90"] } };
  });
  app.post("/api/v1/cloudNumber/renewalPackage", async (req) => {
    calls["cloudNumber/renewalPackage"] = req.body;
    return { code: 200, message: "Success", data: { numbers: [{ id: "num-1", phone_number: "+15551230001", expired_at: "2026-07-01", duration: [30, 90] }] } };
  });
  app.post("/api/v1/cloudNumber/purchase", async (req) => {
    calls["cloudNumber/purchase"] = req.body;
    return { code: 200, message: "Success", data: { order_id: "ord-num-1" } };
  });
  app.post("/api/v1/cloudNumber/renewal", async (req) => {
    calls["cloudNumber/renewal"] = req.body;
    return { code: 200, message: "Success", data: { order_id: "ord-num-renew" } };
  });

  return { app, calls };
}

describe("proxy cloud number routes", () => {
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

  it("GET numbers returns paginated items", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/numbers" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({ id: "num-1", phone_number: "+15551230001" });
    expect(calls["cloudNumber/numberList"]).toMatchObject({ page: 1, pagesize: 20 });
  });

  it("GET numbers/:id/sms forwards id as number_id (not literal)", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/numbers/num-42/sms" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({ code: "123456" });
    const sent = calls["cloudNumber/smsList"] as { number_id?: string };
    expect(sent.number_id).toBe("num-42");
    expect(sent.number_id).not.toBe(":id");
  });

  it("POST numbers/package forwards body", async () => {
    await makeApp().inject({ method: "POST", url: "/api/numbers/package", payload: { region: "US", type: "mobile" } });
    expect(calls["cloudNumber/package"]).toMatchObject({ region: "US", type: "mobile" });
  });

  it("POST numbers/renewal-package forwards {number_ids}", async () => {
    await makeApp().inject({ method: "POST", url: "/api/numbers/renewal-package", payload: { number_ids: ["num-1"] } });
    expect(calls["cloudNumber/renewalPackage"]).toMatchObject({ number_ids: ["num-1"] });
  });

  it("POST numbers/purchase passes body through", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/numbers/purchase", payload: { region: "US", duration: 30, quantity: 1 } });
    expect(res.json()).toMatchObject({ order_id: "ord-num-1" });
    expect(calls["cloudNumber/purchase"]).toMatchObject({ region: "US", duration: 30, quantity: 1 });
  });

  it("POST numbers/renew forwards {list}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/numbers/renew", payload: { list: [{ number_ids: ["num-1"], duration: 30 }] } });
    expect(res.json()).toMatchObject({ order_id: "ord-num-renew" });
    expect(calls["cloudNumber/renewal"]).toMatchObject({ list: [{ number_ids: ["num-1"], duration: 30 }] });
  });
});
