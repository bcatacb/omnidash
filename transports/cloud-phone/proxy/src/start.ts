import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch { /* no .env present */ }

const cfg = loadConfig();
buildApp(cfg).listen({ port: cfg.port, host: "0.0.0.0" }).then(() => console.log(`proxy on :${cfg.port} -> ${cfg.baseUrl}`));
