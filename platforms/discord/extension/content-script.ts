export {};

// extension/content-script.ts
// We don't actually need a persistent content script — the activate flow uses
// chrome.scripting.executeScript injected on demand. This file exists only so
// chrome shows the extension as "active" on discord.com tabs. Console log so
// the operator can confirm install when troubleshooting.
console.log("[GG Account Switcher] content script loaded on", location.host);
