// v0.73.2 — CapSolver API client for hCaptcha Enterprise.
//
// Why CapSolver: their hCaptcha solving runs through residential IPs that
// pass Discord's enterprise rqdata-binding check (the failure mode that
// killed 2Captcha for us). Documented ~70% conversion on Discord
// hCaptcha Enterprise.
//
// API: https://docs.capsolver.com/guide/getting-started.html
//   POST /createTask      → {errorId, taskId}
//   POST /getTaskResult   → {errorId, status, solution: {gRecaptchaResponse}}
// Auth is via `clientKey` field in JSON body (NOT a header).

const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY || "";
const CAPSOLVER_BASE = "https://api.capsolver.com";
const POLL_INTERVAL_MS = 3_000;
const MAX_WAIT_MS = 120_000;

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface CapsolverResult {
  ok: boolean;
  token?: string;
  taskId?: string;
  costCents?: number;
  error?: string;
}

export function capsolverEnabled(): boolean {
  return !!CAPSOLVER_API_KEY;
}

/**
 * Solve hCaptcha Enterprise via CapSolver. Returns a captcha_key token Discord
 * accepts in the retry. rqdata is the enterprise binding data Discord returns
 * in the original 400 response — must be passed through or the token will be
 * rejected as session-mismatched.
 */
export async function solveHCaptchaEnterprise(opts: {
  sitekey: string;
  pageUrl: string;
  rqdata?: string;
  accountId?: string;
}): Promise<CapsolverResult> {
  if (!CAPSOLVER_API_KEY) return { ok: false, error: "CAPSOLVER_API_KEY not set" };
  if (!opts.sitekey || !opts.pageUrl) return { ok: false, error: "sitekey or pageUrl missing" };

  // 1. Submit task. CapSolver uses `HCaptchaTaskProxyLess` for both standard
  // and enterprise — the difference is whether an enterprisePayload is
  // attached (rqdata + sentry binding). There is no separate "Enterprise"
  // task type in their API.
  const task: any = {
    type: "HCaptchaTaskProxyLess",
    websiteURL: opts.pageUrl,
    websiteKey: opts.sitekey,
    userAgent: USER_AGENT,
  };
  if (opts.rqdata) {
    task.enterprisePayload = { rqdata: opts.rqdata, sentry: true };
  }

  let taskId: string;
  try {
    const r = await fetch(`${CAPSOLVER_BASE}/createTask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, task }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json()) as any;
    if (j?.errorId && j.errorId !== 0) {
      return { ok: false, error: `createTask: ${j.errorCode || ""} ${j.errorDescription || ""}`.trim() };
    }
    taskId = String(j?.taskId || "");
    if (!taskId) return { ok: false, error: `createTask returned no taskId: ${JSON.stringify(j).slice(0, 200)}` };
  } catch (err: any) {
    return { ok: false, error: `createTask threw: ${err?.message || err}` };
  }

  // 2. Poll for result. First poll after 5s, then every 3s up to 2 min.
  await sleep(5_000);
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const r = await fetch(`${CAPSOLVER_BASE}/getTaskResult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, taskId }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await r.json()) as any;
      if (j?.errorId && j.errorId !== 0) {
        return { ok: false, taskId, error: `getTaskResult: ${j.errorCode || ""} ${j.errorDescription || ""}`.trim() };
      }
      const status = String(j?.status || "").toLowerCase();
      if (status === "ready") {
        const token = String(j?.solution?.gRecaptchaResponse || j?.solution?.token || "");
        if (!token) return { ok: false, taskId, error: "ready but empty token" };
        // CapSolver doesn't expose per-solve cost in this response. Track via
        // dashboard. Estimated ~0.15 cents per hCaptcha Enterprise solve.
        return { ok: true, taskId, token, costCents: 1 };
      }
      // status === "processing" or "idle" — keep polling
    } catch (err: any) {
      console.warn(`[capsolver] poll threw: ${err?.message || err}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { ok: false, taskId, error: `timed out after ${MAX_WAIT_MS / 1000}s` };
}

// Balance check — handy for the dashboard.
export async function getBalanceUSD(): Promise<number | null> {
  if (!CAPSOLVER_API_KEY) return null;
  try {
    const r = await fetch(`${CAPSOLVER_BASE}/getBalance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await r.json()) as any;
    if (j?.errorId && j.errorId !== 0) return null;
    return Number(j?.balance || 0);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
