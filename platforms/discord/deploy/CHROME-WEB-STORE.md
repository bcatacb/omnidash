# Publishing GG Account Switcher to the Chrome Web Store

This is a one-time setup. After it ships, you (and anyone else) install via
a clickable link instead of unpacking a zip + Developer-mode sideload.

## What you need

- **Google account** — preferably a dedicated one, not your personal Gmail
- **$5 USD** — one-time developer registration fee
- **Screenshots** — 4 at 1280×800 or 640×400 (see below)
- **Icons** — 128×128 PNG for the listing, optional 48×48 + 16×16 for store tiles
- **Privacy policy URL** — required by Google; can be a simple page on
  gg.linktree.bond explaining tokens never leave the user's browser

## Step-by-step

### 1. One-time: register as a Chrome Web Store developer

1. Go to <https://chrome.google.com/webstore/devconsole>
2. Sign in with the Google account you want to publish under
3. Accept the developer agreement, pay the $5 one-time fee
4. Optional but recommended: verify your domain so listings look more trustworthy

### 2. Bump the version + finalize the manifest

Edit `extension/manifest.json` and bump `"version"` (e.g. `0.1.0` → `0.1.1`).
The store rejects re-uploads with the same version number.

Optional fields worth adding for a polished listing:

```jsonc
{
  "manifest_version": 3,
  "name": "GG Account Switcher",
  "version": "0.1.1",
  "description": "Switch between captured Discord accounts via gg.linktree.bond.",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "author": "Your Name",
  "homepage_url": "https://gg.linktree.bond",
  ...
}
```

Drop the PNGs into `extension/icons/` and update `extension/build.sh` to copy
the `icons/` folder into `dist/` alongside `manifest.json`.

### 3. Build the zip you'll upload

From the repo root:

```bash
cd extension
./build.sh
cd dist
zip -r ../gg-account-switcher-v0.1.1.zip .
```

The resulting zip is the file you upload — same shape as the sideload one,
just with a versioned filename.

### 4. Create the listing in the dev console

In the Chrome Web Store Developer Dashboard → **New Item** → upload the zip.
Fill in:

| Field | Suggested content |
|-------|-------------------|
| **Title** | `GG Account Switcher` |
| **Short description** (132 chars) | `Switch between captured Discord accounts via gg.linktree.bond — tokens never leave your browser.` |
| **Detailed description** | Copy from `extension/README.md`, drop the dev-install steps |
| **Category** | `Productivity` |
| **Language** | English (US) |
| **Privacy policy URL** | `https://gg.linktree.bond/privacy` (write a short page covering: extension fetches tokens from gg, holds them in service-worker memory only, no third-party data collection) |

### 5. Screenshots (4 required)

Take at 1280×800 (recommended) or 640×400. Cover:

1. **The Browser Sessions page on gg.linktree.bond** — showing a group with a few accounts and the Activate buttons
2. **The Setup card** with the Download / paste-ID flow
3. **Chrome's extensions page** showing the GG extension installed
4. **Discord loaded as an account** after clicking Activate

Mac: ⌘+Shift+4 to capture a region. Windows: Snipping Tool. Linux: `gnome-screenshot -a`.

### 6. Permissions justification

The store reviewer asks why each permission is needed. Use these one-liners:

| Permission | Justification |
|------------|---------------|
| `storage` | Save the gg origin URL setting |
| `scripting` | Inject the token-write script into discord.com on user request |
| `tabs` | Find the user's open discord.com tab when they click Activate |
| `alarms` | Reserved for future periodic token-bundle refresh |
| `host: discord.com` | Write localStorage.token on discord.com to switch accounts |
| `host: gg.linktree.bond` | Fetch the user's own token bundle via their session cookie |
| `externally_connectable: gg.linktree.bond` | Receive Activate messages from gg.linktree.bond only |

Lean on "switches the user's Discord session using their own tokens; no
third-party data flow." Reviewers reject extensions that look like data
exfil tools, so make it clear that gg is the user's own account.

### 7. Submit for review

Click **Submit for Review** at the top of the listing draft. Typical timeline:

- **24–48 hours** for an unauthenticated developer's first listing
- **A few hours** for subsequent updates from a trusted developer

Google may ask follow-up questions about permissions. Respond fast — they
close tickets aggressively.

### 8. After approval: update gg.linktree.bond

Once published, the listing URL looks like
`https://chrome.google.com/webstore/detail/gg-account-switcher/<extension-id>`.

The extension ID becomes **fixed** at first install (was randomized while
sideloading). Update `extension/manifest.json` with the published key so
sideload + store installs produce the same ID:

1. Go to <chrome://extensions/> with the published extension installed
2. Copy the public key from the **Details** section
3. Add to `manifest.json`:
   ```json
   "key": "<long base64 string from chrome://extensions>",
   ```
4. Rebuild + rezip + upload as a new version

Then update `app/src/pages/BrowserSessions.tsx` setup card:

- Replace the "Download zip" button with a link to the Chrome Web Store
  listing (operators install via 1 click instead of unpacking)
- Pre-populate the extension ID input with the published ID (no more "go
  copy this from chrome://extensions" step)

That's the polish work that converts this from a sideload-only tool to a
proper end-user-installable product.

## Maintenance after publish

- **Each code change** = bump version in `manifest.json` + rebuild + upload via
  dev console "Add new version"
- **Reviews + ratings** are public — respond to user complaints
- **Permissions changes** trigger a re-review (slower)
- **Removing the extension** from the store doesn't auto-uninstall it from
  users — only blocks new installs

## Honest gotchas

- **Discord ToS:** Google reviewers may flag this as automation/account-sharing.
  Frame it carefully: "user logs into their own accounts more efficiently in
  their own browser." Don't mention scraping/outreach in the listing.
- **Manifest V3 deprecations:** Google rotates required permissions every
  few months. Subscribe to <https://developer.chrome.com/docs/extensions/blog>
  to catch breaking changes before re-submission.
- **If rejected:** you can re-submit immediately after fixing the cited issue.
  Don't argue with the reviewer; just remove the flagged language/permission
  and re-upload.
