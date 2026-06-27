import type { FastifyInstance } from "fastify";
import type { Paginated, AppItem } from "@duoplus/shared";
import type { Caller } from "../core.js";

export function registerAppsRoutes(app: FastifyInstance, call: Caller) {
  app.get("/api/apps/platform", async (req) => {
    const q = req.query as { page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const data = await call<{ list: AppItem[]; total: number }>("/api/v1/app/list", { page, pagesize: pageSize });
    const out: Paginated<AppItem> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });

  app.get("/api/apps/team", async (req) => {
    const q = req.query as { page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const data = await call<{ list: AppItem[]; total: number }>("/api/v1/app/teamList", { page, pagesize: pageSize });
    const out: Paginated<AppItem> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });

  app.post("/api/apps/install", async (req) => {
    const body = req.body as { image_ids: string[]; app_id: string; app_version_id?: string };
    return call("/api/v1/app/install", body);
  });

  app.post("/api/apps/uninstall", async (req) => {
    const body = req.body as { image_ids: string[]; pkg: string };
    return call("/api/v1/app/uninstall", body);
  });

  app.post("/api/apps/start", async (req) => {
    const body = req.body as { image_ids: string[]; pkg: string };
    return call("/api/v1/app/start", body);
  });

  app.post("/api/apps/stop", async (req) => {
    const body = req.body as { image_ids: string[]; pkg: string };
    return call("/api/v1/app/stop", body);
  });

  app.get("/api/apps/installed", async (req) => {
    const q = req.query as { imageId?: string };
    return call<{ list: string[] }>("/api/v1/app/installedList", { image_id: q.imageId });
  });
}
