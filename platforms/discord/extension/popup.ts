export {};

const GG_ORIGIN_KEY = "gg-origin";
const GG_ORIGIN_DEFAULT = "https://80-208-224-130.sslip.io";

const statusEl = document.getElementById("status") as HTMLElement;

async function getOrigin(): Promise<string> {
  const s = await chrome.storage.local.get(GG_ORIGIN_KEY);
  return s[GG_ORIGIN_KEY] || GG_ORIGIN_DEFAULT;
}

async function checkSession() {
  try {
    const origin = await getOrigin();
    const r = await fetch(`${origin}/api/groups`, { credentials: "include" });
    if (r.ok) {
      statusEl.textContent = "✓ Connected to GG";
      statusEl.className = "ok";
    } else if (r.status === 401) {
      statusEl.textContent = "× Not signed in — open GG and log in.";
      statusEl.className = "err";
    } else {
      statusEl.textContent = `× GG returned HTTP ${r.status}`;
      statusEl.className = "err";
    }
  } catch (err: any) {
    statusEl.textContent = `× ${err?.message || "Cannot reach GG"}`;
    statusEl.className = "err";
  }
}

document.getElementById("open-gg")!.addEventListener("click", async () => {
  const origin = await getOrigin();
  chrome.tabs.create({ url: origin });
});

document.getElementById("reset-proxy")!.addEventListener("click", async () => {
  await chrome.proxy.settings.clear({ scope: "regular" });
  chrome.runtime.sendMessage({ type: "reset-proxy" });
  statusEl.textContent = "✓ Proxy reset — reload Discord tab";
  statusEl.className = "ok";
});

document.getElementById("open-options")!.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

void checkSession();
