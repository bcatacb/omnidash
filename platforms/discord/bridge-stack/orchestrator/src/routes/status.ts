import { Router, Request, Response } from "express";
import Database from "better-sqlite3";
import { AccountRecord } from "../types";
import { bridgeStatus } from "../docker";

interface Deps { state: Database.Database; }

export function statusRouter(deps: Deps): Router {
  const r = Router();

  // GET /accounts/:id/status — container + last reported state.
  r.get("/accounts/:id/status", async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    const a = deps.state.prepare<string[], AccountRecord>("SELECT * FROM accounts WHERE account_id = ?").get(id);
    if (!a) return res.status(404).json({ error: "not_found" });

    let container = null as null | { running: boolean; state: string };
    if (a.container_id) {
      container = await bridgeStatus(a.container_id);
    }
    res.json({
      account_id: a.account_id,
      status: a.status,
      container,
      last_state: a.last_state ? JSON.parse(a.last_state) : null,
    });
  });

  // POST /internal/status — receives mautrix-discord status_endpoint POSTs.
  // The bridge authenticates with its appservice as_token (Bearer).
  // We cache the latest payload on the account record so the GET endpoint
  // can serve it without polling the bridge.
  r.post("/internal/status", (req: Request, res: Response) => {
    const auth = req.header("authorization") ?? "";
    const tok = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
    if (!tok) return res.status(401).json({ error: "no_token" });
    const a = deps.state.prepare<string[], AccountRecord>("SELECT * FROM accounts WHERE as_token = ?").get(tok);
    if (!a) return res.status(403).json({ error: "unknown_token" });
    deps.state.prepare("UPDATE accounts SET last_state = ?, updated_at = ? WHERE account_id = ?")
      .run(JSON.stringify(req.body ?? {}), Date.now(), a.account_id);
    res.json({ ok: true });
  });

  // GET /healthz — liveness probe.
  r.get("/healthz", (_req, res) => res.json({ ok: true }));

  return r;
}
