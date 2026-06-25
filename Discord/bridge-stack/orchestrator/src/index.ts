import express from "express";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { Client as PgClient } from "pg";
import pino from "pino";
import pinoHttp from "pino-http";

import { accountsRouter } from "./routes/accounts";
import { statusRouter } from "./routes/status";

const PORT = Number(process.env.ORCH_PORT ?? "7000");
const DATA_DIR = process.env.ORCH_DATA_DIR ?? "/data";
const HOMESERVER_URL = process.env.ORCH_HOMESERVER_URL ?? "http://hungryshim:8008";
const HOMESERVER_DOMAIN = process.env.ORCH_HOMESERVER_DOMAIN ?? "bridge.local";

const PG_HOST = process.env.ORCH_POSTGRES_HOST ?? "postgres";
const PG_PORT = process.env.ORCH_POSTGRES_PORT ?? "5432";
const PG_USER = process.env.ORCH_POSTGRES_USER ?? "bridge";
const PG_PASS = process.env.ORCH_POSTGRES_PASSWORD ?? "bridge";
const PG_DB   = process.env.ORCH_POSTGRES_DB   ?? "bridge";

function postgresDsnForSchema(schema: string): string {
  // mautrix-discord uses the schema by setting search_path through the URL.
  const params = new URLSearchParams({ sslmode: "disable", search_path: schema });
  return `postgres://${encodeURIComponent(PG_USER)}:${encodeURIComponent(PG_PASS)}@${PG_HOST}:${PG_PORT}/${PG_DB}?${params.toString()}`;
}

async function pgClient(): Promise<PgClient> {
  const c = new PgClient({
    host: PG_HOST,
    port: Number(PG_PORT),
    user: PG_USER,
    password: PG_PASS,
    database: PG_DB,
  });
  await c.connect();
  return c;
}

function openState(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "orchestrator.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      account_id        TEXT PRIMARY KEY,
      tenant_id         TEXT NOT NULL,
      label             TEXT NOT NULL,
      container_id      TEXT,
      container_name    TEXT NOT NULL,
      config_path       TEXT NOT NULL,
      postgres_schema   TEXT NOT NULL,
      as_token          TEXT NOT NULL UNIQUE,
      hs_token          TEXT NOT NULL,
      status            TEXT NOT NULL,
      last_state        TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS accounts_by_tenant ON accounts(tenant_id);
  `);
  return db;
}

async function main() {
  const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
  const state = openState();
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger: log }));

  app.use("/accounts", accountsRouter({
    state,
    pg: pgClient,
    homeserverUrl: HOMESERVER_URL,
    homeserverDomain: HOMESERVER_DOMAIN,
    postgresDsn: postgresDsnForSchema,
  }));
  app.use("/", statusRouter({ state }));

  app.listen(PORT, () => log.info({ port: PORT }, "orchestrator listening"));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("fatal", e);
  process.exit(1);
});
