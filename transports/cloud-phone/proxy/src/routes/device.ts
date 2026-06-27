import type { FastifyInstance } from "fastify";
import type { PhoneDetail } from "@duoplus/shared";
import type { Caller } from "../core.js";

export function registerDeviceRoutes(app: FastifyInstance, call: Caller) {
  // Literal GET routes MUST be registered before the /:id param route so they
  // are not captured as id="members".
  app.get("/api/phones/members", async () => {
    return call<{ list: Array<{ user_id: string; nickname: string }> }>("/api/v1/cloudPhone/linkUserList", {});
  });

  app.get("/api/phones/:id", async (req) => {
    const { id } = req.params as { id: string };
    return call<PhoneDetail>("/api/v1/cloudPhone/info", { image_id: id });
  });

  app.post("/api/phones/buy", async (req) => {
    const body = req.body as { os: string; duration: number; quantity: number; coupon_code?: string; renewal_status?: number };
    return call("/api/v1/cloudPhone/purchase", body);
  });

  app.post("/api/phones/renew", async (req) => {
    const body = req.body as { image_ids: string[]; duration: number; coupon_code?: string };
    return call("/api/v1/cloudPhone/renewal", body);
  });

  app.post("/api/phones/modify", async (req) => {
    const body = req.body as { images: unknown[] };
    return call("/api/v1/cloudPhone/update", body);
  });

  app.post("/api/phones/root", async (req) => {
    const body = req.body as { image_ids: string[]; status: number; pkgs?: string[] };
    return call("/api/v1/cloudPhone/batchRoot", body);
  });

  app.post("/api/phones/reset", async (req) => {
    return call("/api/v1/cloudPhone/newPhone", req.body);
  });

  app.post("/api/phones/share", async (req) => {
    const body = req.body as { share: unknown };
    return call("/api/v1/cloudPhone/share", body);
  });

  app.post("/api/phones/share-password", async (req) => {
    const body = req.body as { images: unknown };
    return call("/api/v1/cloudPhone/updateSharePassword", body);
  });

  app.post("/api/phones/write-sms", async (req) => {
    const body = req.body as { image_id: string[]; sms: unknown };
    return call("/api/v1/cloudNumber/imageWriteSms", body);
  });

  app.post("/api/phones/live", async (req) => {
    return call("/api/v1/cloudPhone/live", req.body);
  });

  app.post("/api/phones/scan", async (req) => {
    const body = req.body as { image_id: string; id: string };
    return call("/api/v1/cloudPhone/scan", body);
  });

  app.post("/api/phones/adb", async (req) => {
    const body = req.body as { image_ids?: string[]; image_id?: string; command: string };
    return call("/api/v1/cloudPhone/command", body);
  });

  app.post("/api/phones/adb/enable", async (req) => {
    const body = req.body as { image_ids: string[] };
    return call("/api/v1/cloudPhone/openAdb", body);
  });

  app.post("/api/phones/adb/disable", async (req) => {
    const body = req.body as { image_ids: string[] };
    return call("/api/v1/cloudPhone/closeAdb", body);
  });
}
