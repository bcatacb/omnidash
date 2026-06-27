import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

function fakeUpstream(): { app: FastifyInstance; calls: Record<string, unknown> } {
  const app = Fastify();
  const calls: Record<string, unknown> = {};
  const platformApps = [
    { id: "a1", name: "Chrome", pkg: "com.android.chrome", version_list: [{ id: "v1", name: "120.0" }] },
    { id: "a2", name: "WhatsApp", pkg: "com.whatsapp", version_list: [{ id: "v2", name: "2.24" }] },
  ];
  const teamApps = [
    { id: "t1", name: "Internal Tool", pkg: "com.acme.tool", version_list: [{ id: "tv1", name: "1.0" }] },
  ];

  app.post("/api/v1/app/list", async (req) => {
    calls["app/list"] = req.body;
    const body = req.body as { page: number; pagesize: number };
    return { code: 200, message: "Success", data: { list: platformApps, page: body.page, pagesize: body.pagesize, total: 2, total_page: 1 } };
  });
  app.post("/api/v1/app/teamList", async (req) => {
    calls["app/teamList"] = req.body;
    const body = req.body as { page: number; pagesize: number };
    return { code: 200, message: "Success", data: { list: teamApps, page: body.page, pagesize: body.pagesize, total: 1, total_page: 1 } };
  });
  app.post("/api/v1/app/install", async (req) => {
    calls["app/install"] = req.body;
    return { code: 200, message: "Success", data: { message: "success" } };
  });
  app.post("/api/v1/app/uninstall", async (req) => {
    calls["app/uninstall"] = req.body;
    return { code: 200, message: "Success", data: { message: "success" } };
  });
  app.post("/api/v1/app/start", async (req) => {
    calls["app/start"] = req.body;
    return { code: 200, message: "Success", data: { message: "success" } };
  });
  app.post("/api/v1/app/stop", async (req) => {
    calls["app/stop"] = req.body;
    return { code: 200, message: "Success", data: { message: "success" } };
  });
  app.post("/api/v1/app/installedList", async (req) => {
    calls["app/installedList"] = req.body;
    return { code: 200, message: "Success", data: { list: ["com.android.chrome", "com.whatsapp"] } };
  });

  return { app, calls };
}

describe("proxy apps routes", () => {
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

  it("GET /api/apps/platform maps list -> items", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/apps/platform?page=1&pageSize=20" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(body.items[0]).toMatchObject({ id: "a1", name: "Chrome", pkg: "com.android.chrome" });
    expect(calls["app/list"]).toMatchObject({ page: 1, pagesize: 20 });
  });

  it("GET /api/apps/team maps list -> items", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/apps/team?page=1&pageSize=20" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ id: "t1", pkg: "com.acme.tool" });
    expect(calls["app/teamList"]).toMatchObject({ page: 1, pagesize: 20 });
  });

  it("POST /api/apps/install forwards {image_ids,app_id}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/apps/install", payload: { image_ids: ["cp-1"], app_id: "a1" } });
    expect(res.statusCode).toBe(200);
    expect(calls["app/install"]).toMatchObject({ image_ids: ["cp-1"], app_id: "a1" });
  });

  it("POST /api/apps/install forwards app_version_id when present", async () => {
    await makeApp().inject({ method: "POST", url: "/api/apps/install", payload: { image_ids: ["cp-1"], app_id: "a1", app_version_id: "v1" } });
    expect(calls["app/install"]).toMatchObject({ image_ids: ["cp-1"], app_id: "a1", app_version_id: "v1" });
  });

  it("POST /api/apps/uninstall forwards {image_ids,pkg}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/apps/uninstall", payload: { image_ids: ["cp-1"], pkg: "com.whatsapp" } });
    expect(res.statusCode).toBe(200);
    expect(calls["app/uninstall"]).toMatchObject({ image_ids: ["cp-1"], pkg: "com.whatsapp" });
  });

  it("POST /api/apps/start forwards {image_ids,pkg}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/apps/start", payload: { image_ids: ["cp-1"], pkg: "com.whatsapp" } });
    expect(res.statusCode).toBe(200);
    expect(calls["app/start"]).toMatchObject({ image_ids: ["cp-1"], pkg: "com.whatsapp" });
  });

  it("POST /api/apps/stop forwards {image_ids,pkg}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/apps/stop", payload: { image_ids: ["cp-1"], pkg: "com.whatsapp" } });
    expect(res.statusCode).toBe(200);
    expect(calls["app/stop"]).toMatchObject({ image_ids: ["cp-1"], pkg: "com.whatsapp" });
  });

  it("GET /api/apps/installed forwards image_id and returns list", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/apps/installed?imageId=cp-1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.list).toContain("com.whatsapp");
    expect(calls["app/installedList"]).toMatchObject({ image_id: "cp-1" });
  });
});
