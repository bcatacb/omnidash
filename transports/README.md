# transports/

Execution layers a platform engine can sit on. A platform picks one transport;
the shared core + the `PlatformTransformer` contract stay the same regardless.

| Transport | Engine | Status | Used by |
|---|---|---|---|
| `api/` | Telethon (official API) | planned (Telegram already runs this in `platforms/telegram`) | Telegram |
| `playwright/` | Headless browser automation | planned | Discord (assist), TikTok (web) |
| `cloud-phone/` | **DuoPlus real Android devices** (ADB/Appium + RPA) | ✅ **absorbed** (from `duoapi`) | Snapchat, Instagram, Facebook |

The contract each transport ultimately serves is in `@omnibox/core`
(`packages/core/src/platform-transformer.ts`). The cloud-phone transport's own
device-level contract is `@omnibox/core/cloud-phone`.
