import type { FastifyInstance } from "fastify";
import type { Paginated, CloudPhone } from "@duoplus/shared";
import type { Caller } from "../core.js";
import { type CloudPhoneRaw, mapPhone, mapBatch } from "../upstream.js";

const ACTION_PATH: Record<string, string> = {
  on: "/api/v1/cloudPhone/powerOn",
  off: "/api/v1/cloudPhone/powerOff",
  restart: "/api/v1/cloudPhone/restart",
};

export function registerCloudPhoneRoutes(app: FastifyInstance, call: Caller) {
  app.get("/api/phones", async (req) => {
    const q = req.query as { page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const data = await call<{ list: CloudPhoneRaw[]; total: number }>("/api/v1/cloudPhone/list", { page, pagesize: pageSize });
    const out: Paginated<CloudPhone> = { items: data.list.map(mapPhone), page, pageSize, total: data.total };
    return out;
  });

  app.post("/api/phones/power", async (req, reply) => {
    const body = req.body as { ids: string[]; action: "on" | "off" | "restart" };
    const path = ACTION_PATH[body.action];
    if (!path) return reply.status(400).send({ error: `unknown action: ${body.action}` });
    const data = await call<{ success: string[]; fail: string[] }>(path, { image_ids: body.ids });
    return mapBatch(data);
  });
}
