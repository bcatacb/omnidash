# discord-unibox

Discord multi-account unibox SaaS (skeleton).

This repo was hard-forked from `tg-messaging-saas`. The Telegram layer
has been ripped out, leaving the generic SaaS scaffolding intact (auth,
sessions, billing plans, settings, API keys, lead status CRUD, UI
shell). Discord account integration, message bridge, campaigns, unibox
and groups will land in follow-up agents.

See `../docs/superpowers/specs/2026-05-18-discord-unibox-design.md` for
the design. Grep for `TODO(discord)` to find every route surface that
still needs a Discord bridge implementation.
