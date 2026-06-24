# OmniDash Change Impact One-Pager

**Core Rule**  
Platforms keep their own execution models.  
Unification (inbox + operator account) lives in the **transformers** + **unified DB**.  
The Dash only talks to the normalized unified model.

---

### Quick Impact Table

| If you touch... | Must also update | Can usually ignore |
|-----------------|------------------|--------------------|
| Platform backend internal logic (no change to messages/conversations) | Nothing | Transformers, DB, Dash |
| Message/conversation data shape in a platform | That platform's **transformer** | Other platforms |
| New inbox-visible field | Transformer + unified DB (or `meta`) + Dash | Other platforms |
| Unified DB schema (core tables) | Affected transformers + Dash | Platform execution code |
| Transformer code | Dash (if data/behavior changes) | Other transformers + DB |
| Platform-specific features (campaigns, folders, pipeline, etc.) | Nothing in unified layer | Keep in `meta` or inside platform |
| Operator account / platform_accounts | Unified DB + account listing in transformers | Platform backends |
| Dash UI behavior | Relevant transformer(s) | Platform backends |

**Golden Rule**  
If it only affects one platform's execution or lives in `meta` → **no unified changes needed**.  
If it affects what the operator sees/does in the unified inbox → update the transformer for that platform (and usually DB/Dash).

---

### Layers Quick Ref

- **Platform Backends** (Telegram/Discord/TikTok)  
  Free to change internal execution.  
  If it changes inbox data → hit the transformer.

- **Transformers** (`frontend/src/adapters/`)  
  The shock absorbers. Map platform data → unified model.  
  Adapters live inside the transformers.

- **Unified DB** (`db/unified/`)  
  One DB for operator + inbox.  
  Use `meta` JSONB to avoid schema changes.

- **OmniDash** (the frontend)  
  Only consumes via transformers.  
  Use `getCharacteristics()` for platform differences (speed, transport).

---

**When a change is expensive**  
- New core inbox field  
- Unified DB schema change  
- Cross-platform feature

**When a change is cheap**  
- Pure platform-internal work  
- Stuff hidden in `meta`  
- Platform-only features

Update this as the architecture evolves.
