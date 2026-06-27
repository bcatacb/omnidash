import type { FastifyInstance } from "fastify";
import type { Paginated, Proxy, Group } from "@duoplus/shared";
import type { Caller } from "../core.js";

export function registerOrgRoutes(app: FastifyInstance, call: Caller) {
  // --- Proxies ---
  app.get("/api/proxies", async (req) => {
    const q = req.query as { page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const data = await call<{ list: Proxy[]; total: number }>("/api/v1/proxy/list", { page, pagesize: pageSize });
    const out: Paginated<Proxy> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });

  app.post("/api/proxies", async (req) => {
    const body = req.body as { proxy_list: unknown[]; ip_scan_channel?: unknown };
    return call("/api/v1/proxy/add", body);
  });

  app.post("/api/proxies/delete", async (req) => {
    const body = req.body as { ids: string[] };
    return call("/api/v1/proxy/delete", body);
  });

  app.post("/api/proxies/refresh", async (req) => {
    const body = req.body as { ids: string[] };
    return call("/api/v1/proxy/refresh", body);
  });

  app.post("/api/proxies/update", async (req) => {
    return call("/api/v1/proxy/update", req.body);
  });

  // --- Groups ---
  app.get("/api/groups", async (req) => {
    const q = req.query as { page?: string };
    const page = Number(q.page ?? "1");
    const data = await call<{ list: Group[]; pagesize: number; total: number }>("/api/v1/cloudPhone/groupList", { page });
    const out: Paginated<Group> = { items: data.list, page, pageSize: data.pagesize ?? 200, total: data.total };
    return out;
  });

  app.post("/api/groups", async (req) => {
    const body = req.body as { list: unknown[] };
    return call("/api/v1/cloudPhone/createGroup", body);
  });

  app.post("/api/groups/update", async (req) => {
    const body = req.body as { list: unknown[] };
    return call("/api/v1/cloudPhone/updateGroup", body);
  });

  app.post("/api/groups/delete", async (req) => {
    const body = req.body as { ids: string[] };
    return call("/api/v1/cloudPhone/deleteGroup", body);
  });

  app.post("/api/groups/assign", async (req) => {
    const body = req.body as { id: string; image_ids: string[] };
    return call("/api/v1/cloudPhone/addToGroup", body);
  });

  app.post("/api/groups/move", async (req) => {
    const body = req.body as { id: string; image_ids: string[] };
    return call("/api/v1/cloudPhone/moveToGroup", body);
  });
}
