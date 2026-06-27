# platforms/

One folder per platform. Each implements the `PlatformTransformer` contract
(`@omnibox/core`) on top of a transport, and normalizes into the unified inbox.

| Platform | Transport | Current source (pre-merge) | Status |
|---|---|---|---|
| `telegram/` | api (Telethon) | `omnibox/Telegram` + portal | consolidate |
| `discord/`  | hybrid (Playwright + Matrix bridge) | `/opt/discord-unibox` (live) | **source only**; runtime stays containerized |
| `tiktok/`   | browser / cloud-phone | `/root/C2` (live, "TokTik C2") | absorb c2 (replaces stale `omnibox/TikTok` fork) |
| `instagram/`| cloud-phone | — | greenfield |
| `facebook/` | cloud-phone | — | greenfield |
| `snapchat/` | cloud-phone | — | **greenfield · pilot** |

**Pilot:** `snapchat/` is built first — cloud phones are its only viable path, so it
validates the whole ADB/Appium → normalize → unified-inbox pipeline.
