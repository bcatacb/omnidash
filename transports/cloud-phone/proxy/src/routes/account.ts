import type { FastifyInstance } from "fastify";
import type { Paginated, Order, Subscription } from "@duoplus/shared";
import type { Caller } from "../core.js";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
// ISO8601 with fixed +08:00 offset, e.g. "2026-06-15T00:00:00+08:00"
function fmtIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+08:00`;
}

export function registerAccountRoutes(app: FastifyInstance, call: Caller) {
  app.get("/api/orders", async (req) => {
    const q = req.query as { createdStart?: string; createdEnd?: string; page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const now = new Date();
    const createdEnd = q.createdEnd ?? fmtIso(now);
    const createdStart = q.createdStart ?? fmtIso(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const data = await call<{ list: Order[]; total: number }>("/api/v1/team/order", {
      created_at_start: createdStart,
      created_at_end: createdEnd,
      page,
      pagesize: pageSize,
    });
    const out: Paginated<Order> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });

  app.get("/api/subscriptions", async (req) => {
    const q = req.query as { freeStatus?: string; page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const freeStatus = q.freeStatus !== undefined ? Number(q.freeStatus) : 1;
    const data = await call<{ list: Subscription[]; total: number }>("/api/v1/subscriptionStartup/list", {
      free_status: freeStatus,
      page,
      pagesize: pageSize,
    });
    const out: Paginated<Subscription> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });

  app.post("/api/subscriptions/purchase", async (req) => {
    return call("/api/v1/subscriptionStartup/purchase", req.body);
  });

  app.post("/api/subscriptions/renew", async (req) => {
    const body = req.body as { phone_ids: string[]; duration: number; coupon_code?: string };
    return call("/api/v1/subscriptionStartup/renewal", body);
  });
}
