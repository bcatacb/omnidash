import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

function fakeUpstream(): { app: FastifyInstance; calls: Record<string, unknown> } {
  const app = Fastify();
  const calls: Record<string, unknown> = {};
  const proxies = [
    { id: "p1", name: "Proxy 1", host: "1.2.3.4", port: 1080, user: "u1", area: "US" },
    { id: "p2", name: "Proxy 2", host: "5.6.7.8", port: 1080, user: "u2", area: "DE" },
  ];
  const groups = [
    { id: "g1", name: "Pool", sort: 0, remark: "" },
    { id: "g2", name: "Warmup", sort: 1, remark: "x" },
  ];

  app.post("/api/v1/proxy/list", async (req) => {
    calls["proxy/list"] = req.body;
    const body = req.body as { page: number; pagesize: number };
    return { code: 200, message: "Success", data: { list: proxies, page: body.page, pagesize: body.pagesize, total: 2, total_page: 1 } };
  });
  app.post("/api/v1/proxy/add", async (req) => {
    calls["proxy/add"] = req.body;
    return { code: 200, message: "Success", data: { success: [{ index: 0, id: "p3" }], fail: [] } };
  });
  app.post("/api/v1/proxy/delete", async (req) => {
    calls["proxy/delete"] = req.body;
    const body = req.body as { ids: string[] };
    return { code: 200, message: "Success", data: { success: body.ids, fail: [] } };
  });
  app.post("/api/v1/proxy/refresh", async (req) => {
    calls["proxy/refresh"] = req.body;
    const body = req.body as { ids: string[] };
    return { code: 200, message: "Success", data: { success: body.ids, fail: [] } };
  });
  app.post("/api/v1/proxy/update", async (req) => {
    calls["proxy/update"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success", result: [] } };
  });

  app.post("/api/v1/cloudPhone/groupList", async (req) => {
    calls["groupList"] = req.body;
    const body = req.body as { page: number };
    return { code: 200, message: "Success", data: { list: groups, page: body.page, pagesize: 200, total: 2, total_page: 1 } };
  });
  app.post("/api/v1/cloudPhone/createGroup", async (req) => {
    calls["createGroup"] = req.body;
    return { code: 200, message: "Success", data: { success: [{ index: 0, id: "g3", name: "New", sort: 0, remark: "" }], fail: [] } };
  });
  app.post("/api/v1/cloudPhone/updateGroup", async (req) => {
    calls["updateGroup"] = req.body;
    return { code: 200, message: "Success", data: { success: [{ index: 0, id: "g1", name: "Pool", sort: 0, remark: "" }], fail: [] } };
  });
  app.post("/api/v1/cloudPhone/deleteGroup", async (req) => {
    calls["deleteGroup"] = req.body;
    const body = req.body as { ids: string[] };
    return { code: 200, message: "Success", data: { success: body.ids, fail: [] } };
  });
  app.post("/api/v1/cloudPhone/addToGroup", async (req) => {
    calls["addToGroup"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudPhone/moveToGroup", async (req) => {
    calls["moveToGroup"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success" } };
  });

  return { app, calls };
}

describe("proxy org routes (proxies + groups)", () => {
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

  it("GET /api/proxies maps list -> items", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/proxies?page=1&pageSize=20" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(body.items[0]).toMatchObject({ id: "p1", host: "1.2.3.4", port: 1080 });
    expect(calls["proxy/list"]).toMatchObject({ page: 1, pagesize: 20 });
  });

  it("POST /api/proxies forwards proxy_list to upstream add", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/proxies", payload: { proxy_list: [{ protocol: "socks5", host: "9.9.9.9", port: 1080 }] } });
    expect(res.statusCode).toBe(200);
    expect(calls["proxy/add"]).toMatchObject({ proxy_list: [{ protocol: "socks5", host: "9.9.9.9", port: 1080 }] });
  });

  it("POST /api/proxies/delete forwards ids", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/proxies/delete", payload: { ids: ["p1"] } });
    expect(res.statusCode).toBe(200);
    expect(calls["proxy/delete"]).toMatchObject({ ids: ["p1"] });
  });

  it("POST /api/proxies/refresh forwards ids", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/proxies/refresh", payload: { ids: ["p1"] } });
    expect(res.statusCode).toBe(200);
    expect(calls["proxy/refresh"]).toMatchObject({ ids: ["p1"] });
  });

  it("POST /api/proxies/update passes body through", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/proxies/update", payload: { id: "p1", host: "2.2.2.2" } });
    expect(res.statusCode).toBe(200);
    expect(calls["proxy/update"]).toMatchObject({ id: "p1", host: "2.2.2.2" });
  });

  it("GET /api/groups maps list -> items", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/groups?page=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items[0]).toMatchObject({ id: "g1", name: "Pool" });
    expect(calls["groupList"]).toMatchObject({ page: 1 });
  });

  it("POST /api/groups forwards list to createGroup", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/groups", payload: { list: [{ name: "New" }] } });
    expect(res.statusCode).toBe(200);
    expect(calls["createGroup"]).toMatchObject({ list: [{ name: "New" }] });
  });

  it("POST /api/groups/update forwards list to updateGroup", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/groups/update", payload: { list: [{ id: "g1", name: "Pool" }] } });
    expect(res.statusCode).toBe(200);
    expect(calls["updateGroup"]).toMatchObject({ list: [{ id: "g1", name: "Pool" }] });
  });

  it("POST /api/groups/delete forwards ids", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/groups/delete", payload: { ids: ["g1"] } });
    expect(res.statusCode).toBe(200);
    expect(calls["deleteGroup"]).toMatchObject({ ids: ["g1"] });
  });

  it("POST /api/groups/assign forwards {id,image_ids}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/groups/assign", payload: { id: "g1", image_ids: ["cp-1"] } });
    expect(res.statusCode).toBe(200);
    expect(calls["addToGroup"]).toMatchObject({ id: "g1", image_ids: ["cp-1"] });
  });

  it("POST /api/groups/move forwards {id,image_ids}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/groups/move", payload: { id: "g2", image_ids: ["cp-1", "cp-2"] } });
    expect(res.statusCode).toBe(200);
    expect(calls["moveToGroup"]).toMatchObject({ id: "g2", image_ids: ["cp-1", "cp-2"] });
  });
});
