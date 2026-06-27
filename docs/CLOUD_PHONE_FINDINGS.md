# Cloud-phone live calibration — findings (2026-06-27)

First live run against the real DuoPlus fleet (API key validated). Everything below
is observed, not assumed.

## Fleet
- **21 cloud phones**, each with its own **residential US IP** (per-device proxies DO work).
- Set up for the **poker operation**: apps installed = Telegram, **Instagram**, **TikTok (musically)**, Gmail, YouTube, a proxy provider. **No Snapchat anywhere.**
- Plan allows **one phone mounted at a time** (single concurrency slot). Powering a second returns `"Insufficient balance"` — it's a concurrency cap, not money. → captured as `DeviceScheduler` (concurrency=1, configurable) in `@omnibox/core`.

## What works (the transport is real)
- `cloudPhone/list`, `powerOn/Off`, `app/start|installedList`, `cloudPhone/command` (ADB), and **`screencap` → base64 → PNG** all confirmed against device `awIpn`.
- Verified I can **screenshot a device and see the screen**.

## The decisive finding: vision, not selectors
- **Instagram exposes an empty accessibility tree** — `DuoPlusDumpUI` returned only 3 container nodes, **zero text / content-desc / actionable ids**, even fully loaded. IG (and Snapchat, TikTok) render with custom views.
- ⇒ **Selector-based automation (uiautomator/Appium-by-id) won't work for these apps.** They require **vision-based "computer use"**: screenshot → a vision model reads the screen → tap coordinates → repeat.
- This is the bridge to the Cloudflare **AI brain**: the vision model isn't optional polish — it's *how the apps are navigated at all*.

## Built in response
- `@omnibox/core`: `screenshot()` added to `CloudPhoneTransport`; `DeviceScheduler` for the single-slot constraint.
- `@omnibox/cloud-phone`: `CloudPhoneClient.screenshot()` (screencap→png), and **`VisionAutomator`** — the screenshot→decide→act loop with a pluggable **`VisionDriver`** (OCR or a vision LLM / Cloudflare Workers AI / Claude).
- `UiAutomator` (selector helper) stays for apps that *do* expose a tree.

## Open snag (needs you)
- On `awIpn`, **Instagram renders a blank white screen** (just the status bar). The app isn't drawing — likely that account/device's IG is logged out / stuck / resisting. To calibrate the vision flow we need **one mounted device with a healthy, logged-in Instagram** (or a fix on this one).

## Next
1. Get one device with a working logged-in IG → run `VisionAutomator.pursue("open DM inbox, read conversations")` with a vision driver → first real cloud-phone inbox into the unified model.
2. Implement a `VisionDriver` backed by a vision model (Workers AI / Claude).
3. Same pattern then covers Snapchat + TikTok-mobile.
