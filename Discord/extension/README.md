# GG Account Switcher

Chrome/Brave/Edge extension that pairs with [gg.linktree.bond](https://gg.linktree.bond)
to switch between captured Discord accounts.

## Install (development, sideload)

1. Clone this repo, then:
   ```bash
   cd extension
   npm install
   ./build.sh
   ```
2. Open `chrome://extensions`.
3. Toggle **Developer mode** in the top-right.
4. Click **Load unpacked** and select `extension/dist/`.
5. Copy the extension ID Chrome assigns.
6. Open gg.linktree.bond → Browser sessions page.
7. Open browser DevTools console on that page and run:
   ```javascript
   localStorage.setItem("gg-extension-id", "PASTE_EXTENSION_ID_HERE")
   ```
8. Reload the page. Activate buttons should now work.

## How it works

- The extension keeps **no persistent token storage**.
- When you click "Activate @account" in gg, the web app posts a message to the extension.
- Extension calls `https://gg.linktree.bond/api/groups/:id/token-bundle` using your gg session cookie.
- It picks the token for that one account and writes it to `localStorage.token` on your discord.com tab.
- Reloads the tab. You're logged in as that account.
- Browser close → tokens evicted from extension memory.

## Permissions explained

| Permission | Why |
|------------|-----|
| `storage` | Saves only the extension settings (gg URL). No tokens persisted. |
| `scripting` | Inject the token-write script into discord.com. |
| `tabs` | Find your discord.com tab to inject into. |
| `host_permissions: discord.com` | Needed to write to discord.com's localStorage. |
| `host_permissions: gg.linktree.bond` | Fetch the token bundle from gg using your session cookie. |
| `externally_connectable: gg.linktree.bond` | Accept "activate" messages only from gg. |
