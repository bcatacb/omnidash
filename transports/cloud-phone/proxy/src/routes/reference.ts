import type { FastifyInstance } from "fastify";
import type { Paginated, Tag, ResourceItem } from "@duoplus/shared";
import type { Caller } from "../core.js";

export function registerReferenceRoutes(app: FastifyInstance, call: Caller) {
  // Model list (nested brand -> model -> { name }); os is an int code.
  app.get("/api/reference/models", async (req) => {
    const q = req.query as { os?: string };
    return call("/api/v1/mobile/modelList", { os: Number(q.os) });
  });

  // Resource / OS-Region availability list.
  app.get("/api/reference/resources", async () => {
    return call<{ list: ResourceItem[] }>("/api/v1/cloudPhone/cloudPhone", {});
  });

  // Resolution (dpi_name) list.
  app.get("/api/reference/resolutions", async () => {
    return call<{ list: string[] }>("/api/v1/cloudPhone/resolutionList", {});
  });

  // Tag list -> normalized to Paginated.
  app.get("/api/reference/tags", async (req) => {
    const q = req.query as { name?: string; page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const data = await call<{ list: Tag[]; total: number }>("/api/v1/cloudPhone/tagList", {
      name: q.name,
      page,
      pagesize: pageSize,
    });
    const out: Paginated<Tag> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });
}
