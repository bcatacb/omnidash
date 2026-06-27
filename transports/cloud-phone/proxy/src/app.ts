import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type { ProxyConfig } from "./config.js";
import { makeCaller, registerErrorHandler } from "./core.js";
import { registerCloudPhoneRoutes } from "./routes/cloudPhone.js";
import { registerOrgRoutes } from "./routes/org.js";
import { registerAppsRoutes } from "./routes/apps.js";
import { registerDriveRoutes } from "./routes/drive.js";
import { registerDeviceRoutes } from "./routes/device.js";
import { registerAutomationRoutes } from "./routes/automation.js";
import { registerCloudNumberRoutes } from "./routes/cloudNumber.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerReferenceRoutes } from "./routes/reference.js";

export function buildApp(cfg: ProxyConfig): FastifyInstance {
  const app = Fastify();
  app.register(multipart);
  registerErrorHandler(app);

  // Optional shared-secret gate: when CONSOLE_TOKEN is set, every /api/ request
  // must carry a matching x-console-token header. /health is always open.
  if (cfg.consoleToken) {
    app.addHook("onRequest", async (req, reply) => {
      if (!req.url.startsWith("/api/")) return;
      if (req.headers["x-console-token"] !== cfg.consoleToken) {
        return reply.status(401).send({ error: "unauthorized: missing/invalid console token" });
      }
    });
  }

  // Unauthenticated liveness probe.
  app.get("/health", async () => ({ ok: true }));

  const call = makeCaller(cfg);
  registerCloudPhoneRoutes(app, call);
  registerOrgRoutes(app, call);
  registerAppsRoutes(app, call);
  registerDriveRoutes(app, call);
  registerDeviceRoutes(app, call);
  registerAutomationRoutes(app, call);
  registerCloudNumberRoutes(app, call);
  registerAccountRoutes(app, call);
  registerReferenceRoutes(app, call);

  // Single-process production: serve the built web (web/dist) at root with an
  // SPA fallback. Only register when the dist dir exists (so dev/test, where it
  // may be absent, never crash) or when explicitly requested via SERVE_WEB=1.
  const distDir = fileURLToPath(new URL("../../web/dist", import.meta.url));
  const wantWeb = process.env.SERVE_WEB === "1" || existsSync(distDir);
  if (wantWeb && existsSync(distDir)) {
    app.register(fastifyStatic, { root: distDir });
    app.setNotFoundHandler((req, reply) => {
      // Never SPA-fallback API routes — let them 404 as JSON-ish.
      if (req.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
