// v0.83 — port-per-solve relay (no credentials passed to 2captcha, fixes 500 errors).
//
// History:
//   v0.77 — proxy removed from 2captcha calls (residential proxies block inbound 2captcha workers).
//   v0.82 — capsolver removed; 2captcha is the sole solver.
//   v0.83 — VPS relay added: each solve spins up a temp port; 2captcha connects
//           to VPS:PORT (no credentials) and the relay tunnels through the account's
//           residential proxy so hCaptcha binds the token to the correct IP.
//
// Other solver shapes still available for non-token flows:
//   - browserJoinWithCaptcha — Playwright + Gemini vision (join_server)
//   - visionAnalyzeCaptcha   — low-level vision tile-picker

export { browserJoinWithCaptcha } from "./browser-captcha-join";
export { solveCaptcha as visionAnalyzeCaptcha } from "./vision-solver";
import { lookupAccountProxy } from "./discord-http";
import { startSolveRelay, ProxyRelay } from "./captcha-proxy-relay";

export interface SolveTokenOpts {
  sitekey: string;
  pageUrl: string;
  rqdata?: string;
  rqtoken?: string;
  accountId?: string;
}

export interface SolveTokenResult {
  ok: boolean;
  token?: string;
  rqtoken?: string;
  solverUsed?: "twocaptcha";
  costCents?: number;
  error?: string;
  attempts?: number;
  unsolvable?: boolean;
}

const SOLVE_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;

export async function solveCaptchaForToken(opts: SolveTokenOpts): Promise<SolveTokenResult> {
  if (!opts.sitekey || !opts.pageUrl) {
    return { ok: false, error: "missing sitekey or pageUrl" };
  }
  const twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY || "";
  if (!twoCaptchaKey) {
    return { ok: false, error: "no captcha solver configured (set TWOCAPTCHA_API_KEY)" };
  }
  // Per-account proxy is REQUIRED for hCaptcha correctness: hCaptcha embeds the
  // solving IP in the token; Discord verifies it with hCaptcha. Proxyless solve
  // → IP mismatch → low trust score → token revocation.
  const proxyUrl = opts.accountId ? await lookupAccountProxy(opts.accountId).catch(() => undefined) : undefined;
  if (!proxyUrl) {
    console.warn(`[captcha] account=${opts.accountId || "?"} has no proxy assigned — solving WITHOUT proxy (IP mismatch risk)`);
  }
  return twoCaptchaSolveWithRetry(opts, twoCaptchaKey, proxyUrl);
}

// ─── 2captcha ────────────────────────────────────────────────────────────────
//
// Enterprise hCaptcha (rqdata present):
//   Both JSON API and form API run in parallel — different worker pools.
//   The form API occasionally solves Enterprise tasks (observed 124s solve).
//   The JSON API routes to the proper Enterprise queue.
//   Whichever resolves first wins.
//
// Plain hCaptcha (no rqdata) → form API only (fast, reliable).

async function twoCaptchaSolveWithRetry(opts: SolveTokenOpts, apiKey: string, proxyUrl?: string): Promise<SolveTokenResult> {
  const hasRqdata = !!opts.rqdata;

  // For Discord join captchas with rqdata (Enterprise), prefer JSON Enterprise API first
  // because it routes to better workers for these tasks. Form API as fallback.
  // The token format from JSON still works for Discord when using HCaptchaTask.
  if (hasRqdata) {
    console.log(`[captcha] rqdata present — trying json-enterprise first for better Enterprise pool`);
    const first = await twoCaptchaSolve(opts, apiKey, 1, proxyUrl, true);
    if (first.ok && first.token) {
      return { ok: true, token: first.token, rqtoken: first.respKey || opts.rqtoken, solverUsed: "twocaptcha", costCents: first.costCents || 0, attempts: 1 };
    }
    if (first.unsolvable) {
      console.log(`[captcha] json UNSOLVABLE — falling back to form api`);
      const second = await twoCaptchaSolve(opts, apiKey, 2, proxyUrl, false);
      if (second.ok && second.token) {
        return { ok: true, token: second.token, rqtoken: second.respKey || opts.rqtoken, solverUsed: "twocaptcha", costCents: second.costCents || 0, attempts: 2 };
      }
      return { ok: false, error: `2captcha: ${second.error} (after retry)`, solverUsed: "twocaptcha", attempts: 2 };
    }
    return { ok: false, error: `2captcha: ${first.error}`, solverUsed: "twocaptcha", attempts: 1 };
  }

  // Plain hCaptcha: form only (fast, reliable)
  const first = await twoCaptchaSolve(opts, apiKey, 1, proxyUrl, false);
  if (first.ok && first.token) {
    return { ok: true, token: first.token, rqtoken: first.respKey || opts.rqtoken, solverUsed: "twocaptcha", costCents: first.costCents || 0, attempts: 1 };
  }
  if (first.unsolvable) {
    const second = await twoCaptchaSolve(opts, apiKey, 2, proxyUrl, false);
    if (second.ok && second.token) {
      return { ok: true, token: second.token, rqtoken: second.respKey || opts.rqtoken, solverUsed: "twocaptcha", costCents: second.costCents || 0, attempts: 2 };
    }
    return { ok: false, error: `2captcha: ${second.error} (after retry)`, solverUsed: "twocaptcha", attempts: 2 };
  }
  return { ok: false, error: `2captcha: ${first.error}`, solverUsed: "twocaptcha", attempts: 1 };
}

async function twoCaptchaSolve(
  opts: SolveTokenOpts,
  apiKey: string,
  attemptNum: number,
  proxyUrl?: string,
  useJsonApi = false,
): Promise<{ ok: boolean; token?: string; respKey?: string; error?: string; costCents?: number; unsolvable?: boolean }> {
  const TAG = `[2captcha acct=${opts.accountId || "?"} a=${attemptNum}]`;
  const isEnterprise = useJsonApi;
  console.log(`${TAG} createTask: sitekey=${opts.sitekey.slice(0,12)} rqdata=${opts.rqdata ? opts.rqdata.length+'b' : 'none'} enterprise=${isEnterprise} api=${isEnterprise ? 'json' : 'form'}`);

  let taskId = "";

  let solveRelay: ProxyRelay | null = null;
  try {
    if (isEnterprise) {
      // JSON API — Enterprise hCaptcha with rqdata.
      if (proxyUrl) {
        solveRelay = await startSolveRelay(proxyUrl).catch(() => null);
        if (solveRelay) console.log(`${TAG} json-api using relay proxy (${solveRelay.proxyParam})`);
        else console.warn(`${TAG} relay failed — json-api falling back to proxyless`);
      }
      const [relayHost, relayPortStr] = solveRelay ? solveRelay.proxyParam.split(":") : [];
      const task: any = solveRelay ? {
        type: "HCaptchaTask",
        websiteURL: opts.pageUrl,
        websiteKey: opts.sitekey,
        isEnterprise: true,
        enterprisePayload: { rqdata: opts.rqdata },
        proxyType: "http",
        proxyAddress: relayHost,
        proxyPort: Number(relayPortStr),
      } : {
        type: "HCaptchaTaskProxyless",
        websiteURL: opts.pageUrl,
        websiteKey: opts.sitekey,
        isEnterprise: true,
        enterprisePayload: { rqdata: opts.rqdata },
      };
      try {
        const r = await fetch("https://api.2captcha.com/createTask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientKey: apiKey, task }),
        });
        const body = await r.json() as any;
        if (body.errorId !== 0) {
          console.warn(`${TAG} createTask FAILED: ${body.errorCode} — ${body.errorDescription}`);
          return { ok: false, error: `createTask: ${body.errorCode}: ${body.errorDescription}` };
        }
        taskId = String(body.taskId);
      } catch (err: any) {
        return { ok: false, error: `createTask threw: ${err?.message || err}` };
      }
      console.log(`${TAG} task created (json-api): id=${taskId}`);

      const pollStart = Date.now();
      let polls = 0;
      while (Date.now() - pollStart < SOLVE_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        polls++;
        try {
          const r = await fetch("https://api.2captcha.com/getTaskResult", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientKey: apiKey, taskId: Number(taskId) }),
          });
          const body = await r.json() as any;
          if (body.errorId !== 0) {
            const code = body.errorCode || "";
            if (code.includes("UNSOLVABLE") || code.includes("ERROR_CAPTCHA_UNSOLVABLE")) {
              console.warn(`${TAG} UNSOLVABLE: ${code}`);
              return { ok: false, error: "ERROR_CAPTCHA_UNSOLVABLE", unsolvable: true };
            }
            console.warn(`${TAG} poll error: ${code}`);
            return { ok: false, error: `poll: ${code}` };
          }
          if (body.status === "ready") {
            const token = body.solution?.gRecaptchaResponse;
            if (!token) return { ok: false, error: "ready but no token in solution" };
            const respKey: string | undefined = body.solution?.respKey || undefined;
            const elapsed = Math.floor((Date.now() - pollStart) / 1000);
            console.log(`${TAG} SOLVED in ${elapsed}s polls=${polls} tokenLen=${token.length} respKey=${respKey ? respKey.slice(0, 12) + "…" : "none"}`);
            return { ok: true, token, respKey, costCents: 0.3 };
          }
          if (body.status === "processing") {
            if (polls % 3 === 0) console.log(`${TAG} polling… cycle=${polls}`);
            continue;
          }
          return { ok: false, error: `unexpected status: ${body.status}` };
        } catch (err: any) {
          console.warn(`${TAG} poll threw: ${err?.message || err}`);
        }
      }
      console.warn(`${TAG} TIMEOUT after ${SOLVE_TIMEOUT_MS}ms polls=${polls}`);
      fetch("https://api.2captcha.com/reportBad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId: Number(taskId) }),
      }).catch(() => {});
      return { ok: false, error: `solve timeout (${SOLVE_TIMEOUT_MS}ms)` };
    } else {
      // Legacy form API — works fine for plain hCaptcha (no rqdata)
      const createParams = new URLSearchParams({
        key: apiKey,
        method: "hcaptcha",
        sitekey: opts.sitekey,
        pageurl: opts.pageUrl,
        json: "1",
      });
      if (opts.rqdata) {
        createParams.set("data", opts.rqdata);
        createParams.set("invisible", "1");
      }
      if (proxyUrl) {
        solveRelay = await startSolveRelay(proxyUrl).catch(() => null);
        if (solveRelay) {
          createParams.set("proxy", solveRelay.proxyParam);
          createParams.set("proxytype", "HTTP");
          console.log(`${TAG} using relay proxy (${solveRelay.proxyParam})`);
        } else {
          console.warn(`${TAG} VPS_PUBLIC_IP not set — solving WITHOUT relay (IP mismatch risk)`);
        }
      }
      try {
        const r = await fetch(`https://2captcha.com/in.php?${createParams}`, { method: "GET" });
        const body = await r.text();
        let parsed: any = {};
        try { parsed = JSON.parse(body); } catch { /* */ }
        if (parsed?.status !== 1 || !parsed?.request) {
          console.warn(`${TAG} createTask FAILED: ${parsed?.request || body.slice(0,200)}`);
          return { ok: false, error: `createTask: ${parsed?.request || body.slice(0,200)}` };
        }
        taskId = String(parsed.request);
      } catch (err: any) {
        return { ok: false, error: `createTask threw: ${err?.message || err}` };
      }
      console.log(`${TAG} task created (form-api): id=${taskId}`);

      const pollStart = Date.now();
      let polls = 0;
      while (Date.now() - pollStart < SOLVE_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        polls += 1;
        try {
          const r = await fetch(`https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(taskId)}&json=1`, { method: "GET" });
          const body = await r.text();
          let parsed: any = {};
          try { parsed = JSON.parse(body); } catch { /* */ }
          if (parsed?.status === 1 && parsed?.request) {
            const token = String(parsed.request);
            const elapsed = Math.floor((Date.now() - pollStart) / 1000);
            console.log(`${TAG} SOLVED in ${elapsed}s polls=${polls} tokenLen=${token.length}`);
            return { ok: true, token, costCents: 0.3 };
          }
          if (parsed?.request === "CAPCHA_NOT_READY") {
            if (polls % 3 === 0) console.log(`${TAG} polling… cycle=${polls}`);
            continue;
          }
          if (typeof parsed?.request === "string" && parsed.request.includes("UNSOLVABLE")) {
            console.warn(`${TAG} UNSOLVABLE: ${parsed.request}`);
            return { ok: false, error: "ERROR_CAPTCHA_UNSOLVABLE", unsolvable: true };
          }
          console.warn(`${TAG} poll error: http=${r.status} body=${body.slice(0,200)}`);
          return { ok: false, error: `poll error: ${parsed?.request || body.slice(0,200)}` };
        } catch (err: any) {
          console.warn(`${TAG} poll threw: ${err?.message || err}`);
        }
      }
      console.warn(`${TAG} TIMEOUT after ${SOLVE_TIMEOUT_MS}ms polls=${polls}`);
      return { ok: false, error: `solve timeout (${SOLVE_TIMEOUT_MS}ms)` };
    }
  } finally {
    solveRelay?.close();
  }
}

