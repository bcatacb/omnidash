import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

function fakeUpstream(): { app: FastifyInstance; calls: Record<string, unknown> } {
  const app = Fastify();
  const calls: Record<string, unknown> = {};

  app.post("/api/v1/cloudPhone/info", async (req) => {
    calls["cloudPhone/info"] = req.body;
    const body = req.body as { image_id: string };
    return {
      code: 200,
      message: "Success",
      data: {
        id: body.image_id,
        name: "Phone One",
        remark: "secret",
        os: "Android 15",
        group: [{ id: "grp-1", name: "US Warmup" }],
        proxy: { id: "px-1", dns: "1.1.1.1", ip: "104.16.0.1", country: "US", region: "CA", city: "LA", zipcode: "90001" },
        gps: { longitude: -118.2, latitude: 34.0 },
        locale: { timezone: "America/Los_Angeles", language: "en-US" },
        sim: { status: 1, country: "US", msisdn: "+15551234567", operator: "AT&T", msin: "123", iccid: "456", mcc: "310", mnc: "410" },
        bluetooth: { name: "BT", address: "00:11:22:33:44:55" },
        wifi: { status: 1, name: "WIFI", mac: "aa:bb:cc:dd:ee:ff", bssid: "11:22:33:44:55:66" },
        device: { manufacturer: "Samsung", brand: "samsung", model: "SM-G991", imei: "999", serialno: "SN1", android_id: "aid", gsf_id: "gsf", gaid: "gaid" },
      },
    };
  });

  app.post("/api/v1/cloudPhone/batchRoot", async (req) => {
    calls["cloudPhone/batchRoot"] = req.body;
    const body = req.body as { image_ids: string[] };
    return { code: 200, message: "Success", data: { success: body.image_ids, fail: [], fail_reason: {} } };
  });
  app.post("/api/v1/cloudPhone/newPhone", async (req) => {
    calls["cloudPhone/newPhone"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudPhone/share", async (req) => {
    calls["cloudPhone/share"] = req.body;
    return { code: 200, message: "Success", data: { "cp-1": "https://share.example/cp-1" } };
  });
  app.post("/api/v1/cloudPhone/updateSharePassword", async (req) => {
    calls["cloudPhone/updateSharePassword"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudNumber/imageWriteSms", async (req) => {
    calls["cloudNumber/imageWriteSms"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudPhone/live", async (req) => {
    calls["cloudPhone/live"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudPhone/scan", async (req) => {
    calls["cloudPhone/scan"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudPhone/command", async (req) => {
    calls["cloudPhone/command"] = req.body;
    const body = req.body as { image_ids?: string[]; image_id?: string };
    if (body.image_ids) {
      const multi: Record<string, unknown> = {};
      for (const id of body.image_ids) multi[id] = { success: true, content: "ok", message: "ok" };
      return { code: 200, message: "Success", data: multi };
    }
    return { code: 200, message: "Success", data: { success: true, content: "ok", message: "ok" } };
  });
  app.post("/api/v1/cloudPhone/openAdb", async (req) => {
    calls["cloudPhone/openAdb"] = req.body;
    const body = req.body as { image_ids: string[] };
    return { code: 200, message: "Success", data: { success: body.image_ids, fail: [], fail_reason: {} } };
  });
  app.post("/api/v1/cloudPhone/closeAdb", async (req) => {
    calls["cloudPhone/closeAdb"] = req.body;
    const body = req.body as { image_ids: string[] };
    return { code: 200, message: "Success", data: { success: body.image_ids, fail: [], fail_reason: {} } };
  });
  app.post("/api/v1/cloudPhone/linkUserList", async (req) => {
    calls["cloudPhone/linkUserList"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ user_id: "u-1", nickname: "Alice" }, { user_id: "u-2", nickname: "Bob" }] } };
  });

  return { app, calls };
}

describe("proxy device routes", () => {
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

  it("GET /api/phones/:id maps info detail", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/phones/cp-9" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe("cp-9");
    expect(body.proxy.ip).toBe("104.16.0.1");
    expect(body.device.model).toBe("SM-G991");
    expect(calls["cloudPhone/info"]).toMatchObject({ image_id: "cp-9" });
  });

  it("GET /api/phones/members returns members (not id=members)", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/phones/members" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.list).toEqual([{ user_id: "u-1", nickname: "Alice" }, { user_id: "u-2", nickname: "Bob" }]);
    expect(calls["cloudPhone/linkUserList"]).toBeDefined();
    expect(calls["cloudPhone/info"]).toBeUndefined();
  });

  it("POST /api/phones/root forwards {image_ids,status}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/phones/root", payload: { image_ids: ["cp-1", "cp-2"], status: 1 } });
    expect(res.statusCode).toBe(200);
    expect(calls["cloudPhone/batchRoot"]).toMatchObject({ image_ids: ["cp-1", "cp-2"], status: 1 });
  });

  it("POST /api/phones/root forwards pkgs when present", async () => {
    await makeApp().inject({ method: "POST", url: "/api/phones/root", payload: { image_ids: ["cp-1"], status: 3, pkgs: ["com.x"] } });
    expect(calls["cloudPhone/batchRoot"]).toMatchObject({ image_ids: ["cp-1"], status: 3, pkgs: ["com.x"] });
  });

  it("POST /api/phones/reset forwards body incl image_id", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/phones/reset", payload: { image_id: "cp-1", data_type: 1 } });
    expect(res.statusCode).toBe(200);
    expect(calls["cloudPhone/newPhone"]).toMatchObject({ image_id: "cp-1", data_type: 1 });
  });

  it("POST /api/phones/share forwards {share}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/phones/share", payload: { share: [{ image_ids: ["cp-1"], config: { share_status: 1 } }] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ "cp-1": "https://share.example/cp-1" });
    expect(calls["cloudPhone/share"]).toMatchObject({ share: [{ image_ids: ["cp-1"] }] });
  });

  it("POST /api/phones/share-password forwards {images}", async () => {
    await makeApp().inject({ method: "POST", url: "/api/phones/share-password", payload: { images: [{ image_id: "cp-1", password: "secret12" }] } });
    expect(calls["cloudPhone/updateSharePassword"]).toMatchObject({ images: [{ image_id: "cp-1", password: "secret12" }] });
  });

  it("POST /api/phones/write-sms forwards {image_id,sms}", async () => {
    await makeApp().inject({ method: "POST", url: "/api/phones/write-sms", payload: { image_id: ["cp-1"], sms: [{ phone: "+1555", message: "hi" }] } });
    expect(calls["cloudNumber/imageWriteSms"]).toMatchObject({ image_id: ["cp-1"], sms: [{ phone: "+1555", message: "hi" }] });
  });

  it("POST /api/phones/live forwards body", async () => {
    await makeApp().inject({ method: "POST", url: "/api/phones/live", payload: { image_id: "cp-1", status: 1, id: "file-1", loop: 1 } });
    expect(calls["cloudPhone/live"]).toMatchObject({ image_id: "cp-1", status: 1, id: "file-1", loop: 1 });
  });

  it("POST /api/phones/scan forwards {image_id,id}", async () => {
    await makeApp().inject({ method: "POST", url: "/api/phones/scan", payload: { image_id: "cp-1", id: "file-2" } });
    expect(calls["cloudPhone/scan"]).toMatchObject({ image_id: "cp-1", id: "file-2" });
  });

  it("POST /api/phones/adb forwards {image_id,command} and returns content (single)", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/phones/adb", payload: { image_id: "cp-1", command: "getprop" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, content: "ok" });
    expect(calls["cloudPhone/command"]).toMatchObject({ image_id: "cp-1", command: "getprop" });
  });

  it("POST /api/phones/adb forwards {image_ids,command} and returns multi", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/phones/adb", payload: { image_ids: ["cp-1", "cp-2"], command: "getprop" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()["cp-1"]).toMatchObject({ success: true, content: "ok" });
    expect(calls["cloudPhone/command"]).toMatchObject({ image_ids: ["cp-1", "cp-2"], command: "getprop" });
  });

  it("POST /api/phones/adb/enable forwards {image_ids}", async () => {
    await makeApp().inject({ method: "POST", url: "/api/phones/adb/enable", payload: { image_ids: ["cp-1"] } });
    expect(calls["cloudPhone/openAdb"]).toMatchObject({ image_ids: ["cp-1"] });
  });

  it("POST /api/phones/adb/disable forwards {image_ids}", async () => {
    await makeApp().inject({ method: "POST", url: "/api/phones/adb/disable", payload: { image_ids: ["cp-1"] } });
    expect(calls["cloudPhone/closeAdb"]).toMatchObject({ image_ids: ["cp-1"] });
  });
});
