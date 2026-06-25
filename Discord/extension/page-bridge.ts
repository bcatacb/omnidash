export {};

// Runs on the GG web app page (externally_connectable origin).
// Bridges window.postMessage from the React app → chrome.runtime.sendMessage
// in the background service worker. Chrome 120+ removed direct sendMessage
// access from web page context, so this relay is required.

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;
  const { groupId, accountId, navigateChannelId, recipientDiscordUserId } = data;
  if (!groupId || !accountId) return;

  // Read the session token the app stores on sign-in.
  const sessionToken = localStorage.getItem("tg_saas_session") || "";

  if (data.type === "gg-activate") {
    chrome.runtime.sendMessage(
      { type: "activate", groupId, accountId, navigateChannelId, sessionToken },
      (response) => {
        if (chrome.runtime.lastError) {
          window.postMessage({ type: "gg-activate-response", ok: false, error: chrome.runtime.lastError.message }, "*");
          return;
        }
        window.postMessage({ type: "gg-activate-response", ok: true, ...response }, "*");
      },
    );
    return;
  }

  if (data.type === "gg-prepare-and-open") {
    chrome.runtime.sendMessage(
      { type: "prepare-and-open", groupId, accountId, recipientDiscordUserId, sessionToken },
      (response) => {
        if (chrome.runtime.lastError) {
          window.postMessage({ type: "gg-prepare-and-open-response", ok: false, error: chrome.runtime.lastError.message }, "*");
          return;
        }
        window.postMessage({ type: "gg-prepare-and-open-response", ok: true, ...response }, "*");
      },
    );
    return;
  }
});
