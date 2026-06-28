// Cloud-phone proxy + automation proof.
// Run with:  node --env-file=proxy/.env proxy/proxy-check.mjs [mode] [imageId]
//
// Modes:
//   inventory            (default) read-only: list all phones + their assigned proxy. No device mutation.
//   egress  <imageId>    run an ADB egress-IP check on an ALREADY-POWERED-ON phone, compare to assigned proxy.
//   prove   <imageId>    full: power on -> wait -> egress check -> launch TikTok -> screencap. Mutates the device.
//
// Never prints the API key.

const key = process.env.DUOPLUS_API_KEY;
const base = process.env.DUOPLUS_BASE_URL ?? "https://openapi.duoplus.net";
if (!key || key === "PASTE_YOUR_KEY_HERE") {
  console.error("✗ DUOPLUS_API_KEY missing in proxy/.env");
  process.exit(1);
}

const mode = process.argv[2] ?? "inventory";
const imageId = process.argv[3];

const STATUS = { 0: "not-configured", 1: "ON", 2: "off", 3: "expired", 4: "renewal-overdue", 10: "powering-on", 11: "configuring", 12: "config-failed" };
const TIKTOK_PKG = "com.zhiliaoapp.musically";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, body, { retries = 3 } = {}) {
  const url = `${base}${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "DuoPlus-API-Key": key, Lang: "en" },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`non-JSON from ${path}: ${text.slice(0, 300)}`); }
    if (json.code === 429 || res.status === 429) {
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
    }
    if (json.code !== 200) throw new Error(`${path} -> code ${json.code}: ${json.message}`);
    await sleep(1100); // honor 1 QPS/endpoint
    return json.data ?? {};
  }
}

async function listAllPhones() {
  const out = [];
  let page = 1;
  for (;;) {
    const data = await call("/api/v1/cloudPhone/list", { page, pagesize: 50 });
    const list = data.list ?? [];
    out.push(...list);
    const total = data.total ?? out.length;
    if (out.length >= total || list.length === 0) break;
    page++;
  }
  return out;
}

function fmtProxy(p) {
  if (!p || (!p.ip && !p.id)) return "—  NO PROXY";
  const loc = [p.city, p.region, p.country].filter(Boolean).join(", ");
  return `${p.ip ?? "(no ip)"}  [${loc || "?"}]`;
}

async function inventory() {
  console.log(`\n== DuoPlus fleet inventory (read-only) ==`);
  const phones = await listAllPhones();
  console.log(`Auth OK. ${phones.length} phones returned.\n`);
  let withProxy = 0, on = 0;
  const rows = [];
  for (const p of phones) {
    const info = await call("/api/v1/cloudPhone/info", { image_id: p.id });
    const proxy = info.proxy;
    const hasProxy = !!(proxy && (proxy.ip || proxy.id));
    if (hasProxy) withProxy++;
    const st = STATUS[p.status] ?? `status${p.status}`;
    if (p.status === 1) on++;
    rows.push({ id: p.id, name: info.name ?? p.name, status: st, model: info.device?.model, proxy: fmtProxy(proxy) });
  }
  const pad = (s, n) => String(s ?? "").padEnd(n);
  console.log(pad("IMAGE_ID", 16), pad("NAME", 18), pad("STATUS", 12), pad("PROXY (egress expected)", 34));
  console.log("-".repeat(90));
  for (const r of rows) console.log(pad(r.id, 16), pad(r.name, 18), pad(r.status, 12), r.proxy);
  console.log("-".repeat(90));
  console.log(`\nSummary: ${phones.length} phones · ${withProxy} with a proxy assigned · ${on} currently ON`);
  const onPhone = rows.find((r) => r.status === "ON");
  if (onPhone) console.log(`\n▶ A phone is already ON: ${onPhone.id} (${onPhone.name}). Run: node --env-file=proxy/.env proxy/proxy-check.mjs egress ${onPhone.id}`);
  else console.log(`\n▶ No phone is powered on. Phase B needs:  node --env-file=proxy/.env proxy/proxy-check.mjs prove <imageId>`);
}

async function adb(id, command) {
  const data = await call("/api/v1/cloudPhone/command", { image_id: id, command });
  // single shape: { success, content, message }
  return data;
}

async function egressCheck(id) {
  // Find expected proxy
  const info = await call("/api/v1/cloudPhone/info", { image_id: id });
  const expected = info.proxy ?? {};
  console.log(`\n== Egress proof for ${id} (${info.name ?? ""}) ==`);
  console.log(`Assigned proxy: ${fmtProxy(expected)}`);

  // Try a few egress-IP probes (device may lack one curl host)
  const probes = [
    "curl -s --max-time 8 https://api.ipify.org",
    "curl -s --max-time 8 https://ifconfig.me/ip",
    "curl -s --max-time 8 https://ipinfo.io/ip",
  ];
  let egress = "";
  for (const cmd of probes) {
    try {
      const r = await adb(id, cmd);
      const c = (r.content ?? "").trim();
      const m = c.match(/(\d{1,3}\.){3}\d{1,3}/);
      if (m) { egress = m[0]; console.log(`Probe OK via \`${cmd.split(" ").pop()}\`: ${egress}`); break; }
      console.log(`Probe gave no IP (\`${cmd.split(" ").pop()}\`): ${c.slice(0, 120)}`);
    } catch (e) { console.log(`Probe failed: ${e.message}`); }
  }
  if (!egress) { console.log("✗ Could not read egress IP from device."); return false; }

  const match = expected.ip && egress === expected.ip;
  console.log(`\nExpected proxy IP: ${expected.ip ?? "(none)"}`);
  console.log(`Actual egress IP:  ${egress}`);
  console.log(match ? "✅ MATCH — proxy is routing correctly." : `⚠️  MISMATCH — egress != assigned proxy IP (could be CGNAT/exit-node; verify country: expected ${expected.country ?? "?"}).`);
  return match;
}

async function powerOnAndWait(id, maxMs = 120000) {
  console.log(`Powering on ${id} ...`);
  await call("/api/v1/cloudPhone/powerOn", { image_ids: [id] });
  const start = Date.now();
  for (;;) {
    if (Date.now() - start > maxMs) { console.log("✗ timed out waiting for ON"); return false; }
    await sleep(6000);
    const info = await call("/api/v1/cloudPhone/info", { image_id: id });
    const st = STATUS[info.status] ?? info.status;
    console.log(`  status: ${st}`);
    if (info.status === 1) return true;
  }
}

async function prove(id) {
  if (!id) { console.error("Need <imageId>"); process.exit(1); }
  const ok = await powerOnAndWait(id);
  if (!ok) return;
  await sleep(8000); // let network settle
  await egressCheck(id);

  console.log(`\nLaunching TikTok (${TIKTOK_PKG}) ...`);
  try { await adb(id, `monkey -p ${TIKTOK_PKG} -c android.intent.category.LAUNCHER 1`); } catch (e) { console.log(`launch via monkey failed: ${e.message}`); }
  await sleep(6000);
  const fg = await adb(id, "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'").catch(() => ({ content: "" }));
  console.log(`Foreground: ${(fg.content ?? "").trim().slice(0, 200)}`);
  const tiktokUp = (fg.content ?? "").includes("musically");
  console.log(tiktokUp ? "✅ TikTok is in the foreground — automation path works end-to-end." : "⚠️ Could not confirm TikTok foreground (check screencap).");
}

// Time a single raw fetch to the command endpoint (excludes our 1-QPS politeness sleep).
async function timedCmd(id, command) {
  const t0 = performance.now();
  const res = await fetch(`${base}/api/v1/cloudPhone/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "DuoPlus-API-Key": key, Lang: "en" },
    body: JSON.stringify({ image_id: id, command }),
  });
  const json = await res.json();
  const ms = performance.now() - t0;
  if (json.code !== 200) throw new Error(`command code ${json.code}: ${json.message}`);
  return { ms, data: json.data ?? {} };
}

async function control(id) {
  if (!id) { console.error("Need <imageId>"); process.exit(1); }
  console.log(`\n== Control efficiency benchmark for ${id} (command-API path) ==`);
  console.log(`Note: DuoPlus caps cloudPhone/command at ~1 QPS upstream; this measures raw RTT per call.\n`);

  // 1) screen size
  const sz = await timedCmd(id, "wm size");
  console.log(`wm size -> ${(sz.data.content ?? "").trim()}  (${sz.ms.toFixed(0)}ms)`);
  await sleep(1100);

  // 2) screenshot = screencap + base64 (two calls)
  const shots = [];
  for (let i = 0; i < 3; i++) {
    const a = await timedCmd(id, "screencap -p /sdcard/_omni_shot.png"); await sleep(1100);
    const b = await timedCmd(id, "base64 /sdcard/_omni_shot.png"); await sleep(1100);
    const bytes = Buffer.from((b.data.content ?? "").replace(/\s+/g, ""), "base64").length;
    shots.push({ total: a.ms + b.ms, bytes });
    console.log(`screenshot #${i + 1}: screencap ${a.ms.toFixed(0)}ms + base64 ${b.ms.toFixed(0)}ms = ${(a.ms + b.ms).toFixed(0)}ms  (${(bytes / 1024).toFixed(0)} KB PNG)`);
  }

  // 3) taps
  const taps = [];
  for (let i = 0; i < 3; i++) { const r = await timedCmd(id, "input tap 540 1600"); taps.push(r.ms); console.log(`tap #${i + 1}: ${r.ms.toFixed(0)}ms`); await sleep(1100); }

  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const shotAvg = avg(shots.map((s) => s.total));
  const tapAvg = avg(taps);
  console.log(`\n── Command-API control profile ──`);
  console.log(`screenshot avg: ${shotAvg.toFixed(0)}ms (network) — but 2 calls × 1 QPS = ~2s wall-clock min`);
  console.log(`tap avg:        ${tapAvg.toFixed(0)}ms (network) — 1 call × 1 QPS = ~1s wall-clock min`);
  console.log(`vision step (screenshot→tap) realistic wall-clock: ~3s; a 15-step flow ≈ ${(15 * 3)}s`);
  console.log(`\n⇒ Effective for slow/bulk RPA. For responsive vision control, the direct-ADB path is the efficient route.`);
}

async function openadb(id) {
  if (!id) { console.error("Need <imageId>"); process.exit(1); }
  console.log(`\n== Enable direct ADB for ${id} ==`);
  try {
    const r = await call("/api/v1/cloudPhone/openAdb", { image_ids: [id] });
    console.log(`openAdb result:`, JSON.stringify(r));
  } catch (e) { console.log(`openAdb error: ${e.message}`); }
  const info = await call("/api/v1/cloudPhone/info", { image_id: id });
  const adb = info.adb ?? (info.adb_host ? { host: info.adb_host, port: info.adb_port } : null);
  console.log(`Device adb endpoint from info: ${adb ? JSON.stringify(adb) : "(not present on info — check list endpoint / may require whitelist)"}`);
  // also peek the list row
  const all = await listAllPhones();
  const me = all.find((p) => p.id === id);
  console.log(`List row adb field: ${me && me.adb ? JSON.stringify(me.adb) : "(none on list row)"}`);
  if (adb && adb.host) console.log(`\n▶ Try direct connect:  adb connect ${adb.host}:${adb.port}   (needs THIS host's public IP on the DuoPlus ADB whitelist)`);
}

async function whitelist(ipsArg) {
  const ips = (ipsArg || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ips.length) { console.error("Need comma-separated IPs, e.g. whitelist 20.81.133.252"); process.exit(1); }
  console.log(`\n== Set DuoPlus ADB IP whitelist ==`);
  console.log(`Setting ips = ${JSON.stringify(ips)} (replaces the existing list; max 10)`);
  const data = await call("/api/v1/cloudPhone/setAdbIpWhitelist", { ips });
  console.log(`Result:`, JSON.stringify(data));
  console.log(`✅ Whitelist set. ${ips.join(", ")} may now 'adb connect' to the phones.`);
}

async function tiktok(id) {
  if (!id) { console.error("Need <imageId>"); process.exit(1); }
  const info = await call("/api/v1/cloudPhone/info", { image_id: id });
  console.log(`\n== TikTok automation proof for ${id} (${info.name ?? ""}) ==`);
  // status lives on the list endpoint, not info — find this phone there.
  const all = await listAllPhones();
  const me = all.find((p) => p.id === id);
  const st = me ? (STATUS[me.status] ?? me.status) : "unknown";
  if (st !== "ON") { console.log(`✗ phone is ${st}, not ON. Power it on first.`); return; }

  const installed = await call("/api/v1/app/installedList", { image_id: id });
  const has = (installed.list ?? []).includes(TIKTOK_PKG);
  console.log(`TikTok (${TIKTOK_PKG}) installed: ${has ? "yes" : "NO"}`);

  console.log(`Launching TikTok ...`);
  try { await adb(id, `monkey -p ${TIKTOK_PKG} -c android.intent.category.LAUNCHER 1`); } catch (e) { console.log(`launch failed: ${e.message}`); }
  await sleep(7000);
  const fg = await adb(id, "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'").catch(() => ({ content: "" }));
  const line = (fg.content ?? "").trim();
  console.log(`Foreground: ${line.slice(0, 220)}`);
  const up = line.includes("musically");
  console.log(up ? "✅ TikTok is in the foreground — device is drivable end-to-end (auth + ADB + app launch + UI focus)." : "⚠️ Could not confirm TikTok foreground.");
}

const run =
  mode === "egress" ? () => egressCheck(imageId)
  : mode === "tiktok" ? () => tiktok(imageId)
  : mode === "control" ? () => control(imageId)
  : mode === "openadb" ? () => openadb(imageId)
  : mode === "whitelist" ? () => whitelist(imageId)
  : mode === "prove" ? () => prove(imageId)
  : inventory;
run().catch((e) => { console.error("✗", e.message); process.exit(1); });
