import { Router, Request, Response } from "express";
import { Client as PgClient } from "pg";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { CreateAccountBody, LoginBody, AccountRecord, AccountStatus } from "../types";
import { generateToken, writeBridgeConfig, deleteBridgeConfig, writeTokenIndex } from "../config-gen";
import { spawnBridge, stopAndRemove, execLoginToken } from "../docker";

interface Deps {
  state: Database.Database;
  pg: () => Promise<PgClient>;
  homeserverUrl: string;
  homeserverDomain: string;
  postgresDsn: (schema: string) => string;
}

export function accountsRouter(deps: Deps): Router {
  const r = Router();

  function listAccounts(): AccountRecord[] {
    return deps.state.prepare<unknown[], AccountRecord>("SELECT * FROM accounts").all();
  }

  function refreshTokenIndex(): void {
    const all = listAccounts().map((a) => ({
      account_id: a.account_id,
      as_token: a.as_token,
      hs_token: a.hs_token,
    }));
    writeTokenIndex(all);
  }

  function setStatus(account_id: string, status: AccountStatus): void {
    deps.state.prepare("UPDATE accounts SET status = ?, updated_at = ? WHERE account_id = ?")
      .run(status, Date.now(), account_id);
  }

  // POST /accounts — provision a new bridge container.
  r.post("/", async (req: Request, res: Response) => {
    const parsed = CreateAccountBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const { tenant_id, label } = parsed.data;
    const account_id = nanoid(16);
    const schema = `acct_${account_id}`;
    const as_token = generateToken();
    const hs_token = generateToken();
    const now = Date.now();

    // Allocate a postgres schema for this account.
    const pg = await deps.pg();
    try {
      // CREATE SCHEMA cannot be parameterized; we generate the name ourselves
      // from a known-safe nanoid alphabet so this is safe.
      await pg.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    } finally {
      await pg.end();
    }

    const { configPath, registrationPath } = writeBridgeConfig({
      TENANT_ID: tenant_id,
      ACCOUNT_ID: account_id,
      AS_TOKEN: as_token,
      HS_TOKEN: hs_token,
      HOMESERVER_URL: deps.homeserverUrl,
      HOMESERVER_DOMAIN: deps.homeserverDomain,
      POSTGRES_DSN: deps.postgresDsn(schema),
      APPSERVICE_PORT: "29334",
    });

    const rec: AccountRecord = {
      account_id,
      tenant_id,
      label: label ?? account_id,
      container_id: null,
      container_name: `bridge-${account_id}`,
      config_path: configPath,
      postgres_schema: schema,
      as_token,
      hs_token,
      status: "provisioning",
      last_state: null,
      created_at: now,
      updated_at: now,
    };
    deps.state.prepare(`INSERT INTO accounts
      (account_id, tenant_id, label, container_id, container_name, config_path, postgres_schema, as_token, hs_token, status, last_state, created_at, updated_at)
      VALUES (@account_id, @tenant_id, @label, @container_id, @container_name, @config_path, @postgres_schema, @as_token, @hs_token, @status, @last_state, @created_at, @updated_at)`)
      .run(rec);

    refreshTokenIndex();

    try {
      const spawn = await spawnBridge({ account_id, configPath, registrationPath });
      deps.state.prepare("UPDATE accounts SET container_id = ?, status = ?, updated_at = ? WHERE account_id = ?")
        .run(spawn.container_id, "ready", Date.now(), account_id);
    } catch (e) {
      setStatus(account_id, "errored");
      return res.status(500).json({ error: "spawn_failed", message: (e as Error).message, account_id });
    }

    return res.status(201).json({ account_id, tenant_id, status: "ready" });
  });

  // GET /accounts — list (handy for debugging).
  r.get("/", (_req, res) => {
    res.json({ accounts: listAccounts() });
  });

  // GET /accounts/:id — single account.
  r.get("/:id", (req, res) => {
    const a = deps.state.prepare<string[], AccountRecord>("SELECT * FROM accounts WHERE account_id = ?").get(req.params.id ?? "");
    if (!a) return res.status(404).json({ error: "not_found" });
    res.json(a);
  });

  // POST /accounts/:id/login — push a discord token to the bridge.
  r.post("/:id/login", async (req, res) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const a = deps.state.prepare<string[], AccountRecord>("SELECT * FROM accounts WHERE account_id = ?").get(req.params.id ?? "");
    if (!a) return res.status(404).json({ error: "not_found" });
    if (!a.container_id) return res.status(409).json({ error: "no_container" });

    setStatus(a.account_id, "logging_in");
    try {
      const out = await execLoginToken(a.container_id, parsed.data.kind, parsed.data.token);
      if (out.exitCode === 0) {
        setStatus(a.account_id, "logged_in");
        return res.json({ ok: true, output: out.output });
      }
      setStatus(a.account_id, "errored");
      return res.status(500).json({ error: "login_failed", exit_code: out.exitCode, output: out.output });
    } catch (e) {
      setStatus(a.account_id, "errored");
      return res.status(500).json({ error: "login_exec_failed", message: (e as Error).message });
    }
  });

  // DELETE /accounts/:id — stop, remove, drop schema, delete config.
  r.delete("/:id", async (req, res) => {
    const a = deps.state.prepare<string[], AccountRecord>("SELECT * FROM accounts WHERE account_id = ?").get(req.params.id ?? "");
    if (!a) return res.status(404).json({ error: "not_found" });

    if (a.container_id) {
      await stopAndRemove(a.container_id);
    }
    try {
      const pg = await deps.pg();
      try {
        await pg.query(`DROP SCHEMA IF EXISTS "${a.postgres_schema}" CASCADE`);
      } finally {
        await pg.end();
      }
    } catch {
      // Continue; orphan schema is not fatal.
    }
    deleteBridgeConfig(a.account_id);
    deps.state.prepare("DELETE FROM accounts WHERE account_id = ?").run(a.account_id);
    refreshTokenIndex();
    return res.json({ ok: true, account_id: a.account_id });
  });

  return r;
}
