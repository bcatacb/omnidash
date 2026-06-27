# Snapchat engine — calibration (one-time, against a live device)

The engine's orchestration is complete; the Snapchat **element selectors** (`SEL` in
`src/index.ts`, marked `CALIBRATE:`) must be confirmed on a real, logged-in device,
because Snapchat's resource-ids change by app version.

## Prerequisites
1. A DuoPlus cloud phone **logged into a Snapchat account**.
2. The omnibox automation host IP added to the **DuoPlus ADB whitelist** (≤10 IPs).
3. The cloud-phone proxy running (`npm run cloudphone:proxy`, with `DUOPLUS_API_KEY`).

## Calibrate
1. Enable ADB on the device and open Snapchat to the Chat tab.
2. Dump the screen via the transport:
   ```ts
   import { CloudPhoneClient, parseUiDump } from '@omnibox/cloud-phone'
   const cp = new CloudPhoneClient({ baseUrl: 'http://localhost:4000' })
   await cp.startApp([deviceId], 'com.snapchat.android')
   console.log(await cp.dumpUi(deviceId))   // raw UIAutomator XML
   ```
3. Read the real `resource-id`s for: chat-list row, peer name, preview, message text,
   compose input, send button, unread indicator, and message in/out side.
4. Fill them into `SEL` and remove the `CALIBRATE:` notes.

## Then wire it
```ts
import { SnapchatEngine } from '@omnibox/platform-snapchat'
const snap = new SnapchatEngine({
  proxyUrl: 'http://localhost:4000',
  accounts: [{ id: 'acc1', deviceId: '<image_id>', label: 'Snap 1', username: 'handle' }],
})
await snap.listConversations()   // → OmniConversation[] into the unified inbox
```

## Known TODOs (need live device)
- inbound/outbound detection (bounds side vs. row container id)
- per-message timestamps (Snapchat UI shows relative/none — may need heuristics)
- unread detection (the unread dot)
- emoji/multi-line send (adb `input text` can't do emoji — use a clipboard `am`/paste path)
