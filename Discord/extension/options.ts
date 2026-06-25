export {};

const GG_ORIGIN_KEY_OPT = "gg-origin";
const GG_ORIGIN_DEFAULT_OPT = "https://80-208-224-130.sslip.io";

const originInput = document.getElementById("origin") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLElement;

chrome.storage.local.get(GG_ORIGIN_KEY_OPT).then((s) => {
  originInput.value = s[GG_ORIGIN_KEY_OPT] || GG_ORIGIN_DEFAULT_OPT;
});

document.getElementById("save")!.addEventListener("click", async () => {
  const v = originInput.value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(v)) {
    statusEl.textContent = "× Must start with http:// or https://";
    statusEl.className = "err";
    return;
  }
  await chrome.storage.local.set({ [GG_ORIGIN_KEY_OPT]: v });
  statusEl.textContent = "✓ Saved";
  statusEl.className = "ok";
});
