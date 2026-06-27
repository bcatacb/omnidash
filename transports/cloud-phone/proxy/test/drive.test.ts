import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

function fakeUpstream(): { app: FastifyInstance; calls: Record<string, unknown> } {
  const app = Fastify();
  const calls: Record<string, unknown> = {};
  const files = [
    { id: "f1", name: "video.mp4", original_file_name: "promo-video.mp4" },
    { id: "f2", name: "app.apk", original_file_name: "myapp-release.apk" },
  ];

  app.post("/api/v1/cloudDisk/list", async (req) => {
    calls["cloudDisk/list"] = req.body;
    const body = req.body as { keyword?: string; page: number; pagesize: number };
    return { code: 200, message: "Success", data: { list: files, page: body.page, pagesize: body.pagesize, total: 2, total_page: 1 } };
  });
  app.post("/api/v1/cloudDisk/pushFiles", async (req) => {
    calls["cloudDisk/pushFiles"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success", success: [], fail: [] } };
  });
  app.post("/api/v1/cloudDisk/delFiles", async (req) => {
    calls["cloudDisk/delFiles"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudDisk/signedUrl", async (req) => {
    calls["cloudDisk/signedUrl"] = req.body;
    const body = req.body as { name: string };
    return { code: 200, message: "Success", data: { method: "PUT", signedUrl: "https://oss.example/put", headers: { "x-oss-callback": "cb" }, name: body.name, original_file_name: body.name } };
  });

  return { app, calls };
}

// Upstream that returns a signedUrl pointing at its own PUT endpoint and records
// what the OSS PUT received (bytes + headers).
function fakeOssUpstream(): { app: FastifyInstance; setBase: (b: string) => void; put: Record<string, unknown> } {
  const app = Fastify();
  const put: Record<string, unknown> = {};
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  const state = { base: "" };
  app.post("/api/v1/cloudDisk/signedUrl", async (req) => {
    const body = req.body as { name: string };
    return { code: 200, message: "Success", data: { method: "PUT", signedUrl: `${state.base}/__put`, headers: { "x-oss-callback": "cb", "x-oss-callback-var": "v" }, name: body.name, original_file_name: body.name } };
  });
  app.put("/__put", async (req, reply) => {
    put["body"] = req.body;
    put["x-oss-callback"] = req.headers["x-oss-callback"];
    put["x-oss-callback-var"] = req.headers["x-oss-callback-var"];
    return reply.status(200).send("ok");
  });

  return { app, setBase: (b: string) => { state.base = b; }, put };
}

describe("proxy drive routes", () => {
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

  it("GET /api/drive/files maps list -> items", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/drive/files?page=1&pageSize=20" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(body.items[0]).toMatchObject({ id: "f1", name: "video.mp4", original_file_name: "promo-video.mp4" });
    expect(calls["cloudDisk/list"]).toMatchObject({ page: 1, pagesize: 20 });
  });

  it("GET /api/drive/files forwards keyword", async () => {
    await makeApp().inject({ method: "GET", url: "/api/drive/files?keyword=video&page=1&pageSize=20" });
    expect(calls["cloudDisk/list"]).toMatchObject({ keyword: "video", page: 1, pagesize: 20 });
  });

  it("POST /api/drive/push forwards {ids,image_ids,dest_dir}", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/drive/push", payload: { ids: ["f1"], image_ids: ["cp-1"], dest_dir: "/sdcard/Download" } });
    expect(res.statusCode).toBe(200);
    expect(calls["cloudDisk/pushFiles"]).toMatchObject({ ids: ["f1"], image_ids: ["cp-1"], dest_dir: "/sdcard/Download" });
  });

  it("POST /api/drive/delete forwards ids", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/drive/delete", payload: { ids: ["f1"] } });
    expect(res.statusCode).toBe(200);
    expect(calls["cloudDisk/delFiles"]).toMatchObject({ ids: ["f1"] });
  });

  it("POST /api/drive/upload-url mints a signed URL", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/drive/upload-url", payload: { name: "clip.mp4" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.method).toBe("PUT");
    expect(body.signedUrl).toBe("https://oss.example/put");
    expect(calls["cloudDisk/signedUrl"]).toMatchObject({ name: "clip.mp4" });
  });
});

describe("proxy drive upload (server-side OSS PUT)", () => {
  let oss: FastifyInstance; let ossBaseUrl: string; let put: Record<string, unknown>;
  beforeEach(async () => {
    const u = fakeOssUpstream();
    oss = u.app; put = u.put;
    await oss.listen({ port: 0 });
    const addr = oss.server.address();
    ossBaseUrl = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
    u.setBase(ossBaseUrl);
  });
  afterEach(async () => { await oss.close(); });

  it("uploads a multipart file: mints signed url then PUTs bytes + oss headers", async () => {
    const app = buildApp(loadConfig({ DUOPLUS_BASE_URL: ossBaseUrl } as NodeJS.ProcessEnv));
    const boundary = "----testboundary1234";
    const fileBytes = "hello-bytes";
    const body = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="f.png"\r\n` +
      `Content-Type: image/png\r\n\r\n` +
      `${fileBytes}\r\n` +
      `--${boundary}--\r\n`,
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/drive/upload",
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: "f.png", original_file_name: "f.png" });
    expect((put["body"] as Buffer).toString()).toBe(fileBytes);
    expect(put["x-oss-callback"]).toBe("cb");
    expect(put["x-oss-callback-var"]).toBe("v");
  });
});
