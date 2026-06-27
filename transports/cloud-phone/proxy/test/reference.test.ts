import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

function fakeUpstream(): { app: FastifyInstance; calls: Record<string, unknown> } {
  const app = Fastify();
  const calls: Record<string, unknown> = {};

  app.post("/api/v1/mobile/modelList", async (req) => {
    calls["mobile/modelList"] = req.body;
    return { code: 200, message: "Success", data: { Samsung: { m1: { name: "Galaxy S23" } } } };
  });
  app.post("/api/v1/cloudPhone/cloudPhone", async (req) => {
    calls["cloudPhone/cloudPhone"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ name: "US", region_id: "r1", os: "Android 15", count: 10, used_count: 3 }] } };
  });
  app.post("/api/v1/cloudPhone/resolutionList", async (req) => {
    calls["cloudPhone/resolutionList"] = req.body;
    return { code: 200, message: "Success", data: { list: ["720x1280(320dpi)", "1080x1920(480dpi)"] } };
  });
  app.post("/api/v1/cloudPhone/tagList", async (req) => {
    calls["cloudPhone/tagList"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ id: "t1", name: "warm", color: "#f00", image_count: 2 }], page: 1, pagesize: 20, total: 1, total_page: 1 } };
  });

  return { app, calls };
}

describe("proxy reference routes", () => {
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

  it("GET models forwards {os:<number>}", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/reference/models?os=4" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ Samsung: { m1: { name: "Galaxy S23" } } });
    const sent = calls["mobile/modelList"] as { os?: unknown };
    expect(sent.os).toBe(4);
    expect(typeof sent.os).toBe("number");
  });

  it("GET resources returns the list", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/reference/resources" });
    expect(res.statusCode).toBe(200);
    expect(res.json().list[0]).toMatchObject({ name: "US", region_id: "r1" });
  });

  it("GET resolutions returns the list", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/reference/resolutions" });
    expect(res.statusCode).toBe(200);
    expect(res.json().list).toContain("720x1280(320dpi)");
  });

  it("GET tags maps list->items", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/reference/tags?name=warm" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({ id: "t1", name: "warm" });
    expect(res.json().total).toBe(1);
    expect(calls["cloudPhone/tagList"]).toMatchObject({ name: "warm" });
  });
});
