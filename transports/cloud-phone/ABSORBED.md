# cloud-phone transport (absorbed from `duoapi`)

This directory is the former standalone **`duoapi`** project (DuoPlus Cloud Phone
Console), absorbed into the omnibox monorepo on 2026-06-27 as the `cloud-phone`
transport. Source of truth now lives here.

## What's inside (unchanged from duoapi)
- `proxy/` — Node server wrapping the DuoPlus API; keeps `DUOPLUS_API_KEY` server-side,
  enforces 1 QPS + 429 backoff. Sub-packages: `@duoplus/proxy`, `@duoplus/shared`,
  `@duoplus/web`, `@duoplus/mock-server`.
- `web/` — React/Vite console (fleet, devices, apps, automation, drive, numbers).
- `mock-server/` — fake DuoPlus upstream for local dev/tests.
- `shared/` — shared types.
- `docs/superpowers/specs/duoplus-api-inventory.md` — the verified API inventory.

## How it plugs into omnibox
- Its sub-packages are now omnibox npm workspaces (`@duoplus/*`).
- The device-level contract it implements lives in `@omnibox/core/cloud-phone`
  (`CloudPhoneTransport`). A thin adapter mapping the proxy's HTTP routes to that
  contract is the next build step.
- The `web/` console becomes the **"Cloud Phones"** section of the shell.

## Run (dev)
From the omnibox root:
```
npm run cloudphone:mock     # fake DuoPlus on :4100
npm run cloudphone:proxy    # proxy on :4000  (set DUOPLUS_API_KEY for live)
npm run cloudphone:web      # console on :5173
```

## Prerequisite for live ADB/Appium automation
Add the omnibox automation host IP to the DuoPlus **ADB whitelist** (max 10 IPs, team-level).

> The original `~/duoapi` repo is preserved untouched; this is the merged copy.
