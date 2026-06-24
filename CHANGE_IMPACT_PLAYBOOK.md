# OmniDash Change Impact Playbook

**Core Rule**  
- Telegram, Discord, and TikTok keep their own execution models.  
- Only the **unified inbox + operator account** is shared.  
- Changes only need to propagate when they affect the unified view.

---

## Cheat Sheet (Give This to the Team)

| If you touch...                          | You MUST also update...                  | You can usually ignore...                  |
|------------------------------------------|------------------------------------------|--------------------------------------------|
| Platform backend **internal logic** only (no change to messages/conversations) | Nothing | Transformers, DB, Dash |
| Message or conversation **data shape** in a platform | That platform's **transformer** | Other platforms |
| New field you want visible in the unified inbox | Transformer + **unified DB** (or put in `meta`) + Dash (if shown) | Other platforms |
| Unified DB schema (core tables) | All transformers that use it + Dash | Platform execution code |
| Anything in a **transformer** (`telegramAdapter` etc.) | Dash (if data or behavior changes) | Other transformers + DB (usually) |
| Platform-specific features (campaigns, folders, pipeline, etc.) | Nothing in unified layer | Everything unified (keep in `meta` or inside the platform) |
| Operator account / platform_accounts linking | Unified DB + account listing in transformers | Platform backends |
| UI behavior in OmniDash | The relevant transformer(s) | Platform backends |

**Golden Rule**:  
If it only affects one platform's execution or stays inside `meta` → no unified changes needed.  
If it affects what the operator sees or acts on in the unified inbox → update the transformer for that platform.

---

## Core Rule

Each platform keeps its own execution model (Telegram = API, Discord/TikTok = Playwright/hybrid).  
Unification happens in the **transformers** + **unified DB**.  
The UI (OmniDash) only sees the normalized unified model.

Use this as a quick reference: “If I touch X, what else do I need to touch?”

---

## Quick Matrix

| If you change...                          | Must also touch                              | Usually safe to ignore                          | Notes |
|-------------------------------------------|----------------------------------------------|--------------------------------------------------|-------|
| **Platform backend internal logic** (e.g. Playwright selectors, Telethon session handling, rate limiting) that does **not** change message/conversation data | Nothing else | Everything else | Pure platform execution changes stay isolated. |
| **Shape or fields of messages / conversations** in a platform backend | Corresponding **transformer** (`telegramAdapter`, etc.) | Other platforms | Update mapping logic so it still produces correct `Omni*` objects. |
| **New field on messages/conversations** you want visible in unified inbox | Transformer + **unified DB** (add column or put in `meta`) + **Dash** (if you want to display it) | Other platforms | Prefer `meta` JSONB first to avoid schema changes. |
| **Unified DB schema** (core tables like `conversations`, `messages`, `platform_accounts`) | All affected **transformers** + **Dash** UI | Platform-specific backend code that only uses `meta` | Schema changes are high impact. |
| **Transformer** (normalization, id handling, error mapping, `getCharacteristics`) | **Dash** (if behavior or data shape changes) | Other transformers | This is the main translation layer. |
| **Platform characteristics** (`transport`, latency, realtime support) | **Dash** UI (badges, warnings, send hints, etc.) | DB and other platforms | Used to make UI aware of platform differences. |
| **Adding a new platform-specific feature** (e.g. new Discord campaign type, Telegram folder behavior) | Only that platform backend | Unified DB, other transformers, Dash (unless you want to surface it) | Keep it inside the platform or in `meta`. |
| **Operator-level account** (users, platform_accounts linking) | Unified DB + transformers that list accounts | Platform execution details | One operator account owns multiple platform_accounts. |
| **UI behavior in OmniDash** (filters, bulk actions, send flow) | Relevant **transformers** (if they need new data or behavior) | Platform backends | The Dash should only talk to the unified model. |
| **Cross-platform feature** (e.g. shared labels, global search) | Unified DB + all relevant transformers + Dash | Platform-specific internals | These are the expensive changes. |

---

## Detailed Guidance by Area

### 1. Platform Backends (Telegram / Discord / TikTok)
- You are **free** to change anything that stays inside the platform’s execution model.
- If the change produces different data for conversations or messages → the matching transformer **must** be updated.
- Try hard to keep new data in the platform’s own structures or `meta`. Only promote things to the core unified model when the inbox actually needs them.

**Rule of thumb**:  
If the change would not be visible in a normal unified conversation list or message thread → it probably doesn’t need to touch the unified layer.

### 2. Transformers (`frontend/src/adapters/`)
- This is the **translation layer**. Most changes here are required when platform data shapes move.
- Always keep the `PlatformTransformer` contract stable.
- Use `getCharacteristics()` for platform personality (speed, transport type, realtime).
- When adding support for new platform behavior, decide early:
  - Put it in `meta` → low impact
  - Add to core `OmniConversation` / `OmniMessage` → high impact (affects DB + Dash)

### 3. Unified Database (`db/unified/`)
- Treat the core tables (`users`, `platform_accounts`, `conversations`, `messages`) as the **unified inbox contract**.
- Prefer extending via `meta` JSONB columns instead of adding columns.
- Adding a new core column or table is a big deal — it usually requires updates in all three transformers and the Dash.

### 4. OmniDash (frontend UI)
- Should only consume data through the transformers.
- If you need new data, the request should go through the transformer first (don’t bypass to a platform backend).
- Visual differences (badges, warnings, different send behavior) should be driven by `getCharacteristics()` where possible.

---

## Safe vs Dangerous Changes

**Generally safe (low or no cross-touch):**
- Internal improvements to any single platform backend
- New platform-only features (kept in `meta` or platform code)
- UI polish that doesn’t require new data
- Adding more to `getCharacteristics()`

**High coupling (will touch multiple layers):**
- Changing how conversations or messages are identified
- New fields that should be filterable or searchable in the unified inbox
- Schema changes in the unified DB
- New cross-platform capabilities

---

## Quick Decision Checklist

Before making a change, ask:

1. Does this affect what appears in the unified inbox?
   - Yes → touch the transformer for that platform.
2. Does the new data need to be queryable across platforms or stored cleanly?
   - Yes → consider unified DB change (prefer `meta` first).
3. Do users need to see or act on this new thing in OmniDash?
   - Yes → update the Dash.
4. Is this purely platform-specific behavior?
   - Yes → keep it in the platform or `meta`. No unified changes needed.

---

**Goal**: Keep platform execution independent while making the unified inbox and operator account feel like one coherent system.

Update this playbook as the architecture evolves.
