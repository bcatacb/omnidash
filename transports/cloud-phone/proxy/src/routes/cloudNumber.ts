import type { FastifyInstance } from "fastify";
import type { Paginated, CloudNumber, NumberSms } from "@duoplus/shared";
import type { Caller } from "../core.js";

export function registerCloudNumberRoutes(app: FastifyInstance, call: Caller) {
  app.get("/api/numbers", async (req) => {
    const q = req.query as { page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const data = await call<{ list: CloudNumber[]; total: number }>("/api/v1/cloudNumber/numberList", { page, pagesize: pageSize });
    const out: Paginated<CloudNumber> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });

  app.get("/api/numbers/:id/sms", async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const data = await call<{ list: NumberSms[]; total: number }>("/api/v1/cloudNumber/smsList", { number_id: id, page, pagesize: pageSize });
    const out: Paginated<NumberSms> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });

  app.post("/api/numbers/package", async (req) => {
    const body = req.body as { region: string; type?: string };
    return call("/api/v1/cloudNumber/package", body);
  });

  app.post("/api/numbers/renewal-package", async (req) => {
    const body = req.body as { number_ids: string[] };
    return call("/api/v1/cloudNumber/renewalPackage", body);
  });

  app.post("/api/numbers/purchase", async (req) => {
    return call("/api/v1/cloudNumber/purchase", req.body);
  });

  app.post("/api/numbers/renew", async (req) => {
    const body = req.body as { list: unknown[] };
    return call("/api/v1/cloudNumber/renewal", body);
  });
}
