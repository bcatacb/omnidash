# rents.ws — Discord category sellers (manual outreach list)

Source: https://rents.ws/search/categories/discord
Scraped: 2026-05-17
Sellers found: 10 (entire category — no pagination, no other pages)
Telegram handles found: 10/10

All seller deposit pages on rents.ws hide direct contact info — Telegrams below were extracted from each seller's external shop / contacts page.

## Sellers with Telegram (sorted: most established + most Discord-focused first)

| # | Seller | Telegram (primary) | Telegram (secondary) | External site | Products | Registered | Notes |
|---|--------|--------------------|----------------------|---------------|----------|------------|-------|
| 1 | discord-accounts | `@discord_accounts_com` | `@discord_accounts_news` (news) | discord-accounts.com | "Магазин аккаунтов Дискорд №1" — pure Discord focus | 2020-07-18 | Highest priority — only Discord-only seller in the category. |
| 2 | dream-shop | `@Dreamshop_Support` | `@Dreamshopsu` (suppliers) | dream-shop.one | Discord (2017-2024 reg), VK, IG, FB, Twitter, Gmail, YT, TikTok, TG | 2017-10-08 | ~92k orders, 100k RUB deposit. Has dedicated cooperation/supplier contact. |
| 3 | buyaccs | `@buyaccspro_support` | t.me/buyaccspro (channel) | buyaccs.rents.ac (buyaccs.pro) | VK auto-reg, IG, FB, OK + Discord | 2016-02-16 | Established (10 yrs). Also: email `buyaccspro@ya.ru`, Skype `buyaccs.pro`, ICQ `672463604`. |
| 4 | google | `@myaccs_r` | `@igr0k` (admin) | google.rents.ac (my-accs.com) | Discord, Twitter, VK, FB, IG, Mail, Gmail, Outlook, Hotmail | 2017-04-04 | Actively recruiting suppliers — possible upstream contact. Owner @igr0k also linked to RDPLANET. |
| 5 | mail-shop | `@badredhat` | — | mail-shop.rents.ac (mail-shop.deer.is) | Top auto-reg: Discord, Rambler, etc. | 2020-12-06 | Single owner handle. |
| 6 | bosslikepoints23 | `@koschel` | — | bosslikepoints23.rents.ac (koschei.org) | Telegram, Discord, TikTok, other socials | 2021-02-10 | Site lists `@1111111` as decoy/placeholder for support — real owner is `@koschel` (used for manual USDT). |
| 7 | datamoll | `@datamollhelper_bot` | — | datamoll.com | Discord, Telegram, IG, FB | 2026-02-04 | Contact is a TG **bot**, not a human handle — DM may auto-route to support queue. Newly registered. |
| 8 | Panda | `@Panda_support_tg` | t.me/+4o99loFmTQc5MWVk (channel) | Panda.rents.ac | Telegram accounts (also Discord listed) | 2025-06-08 | TG-account focused, Discord is secondary. |
| 9 | 41store | `@Accountseller41` | `@Socialstore41` (channel) | 41store.rents.ac (41social.store) | Discord + social media | 2025-01-05 | International (Pakistan +92). Also WhatsApp `wa.me/923093402020`. English-speaking. |
| 10 | RDPLANET | `@sofianekrim12` | `@igr0k` | RDPLANET.rents.ac | **VPS/RDP servers**, NOT Discord accounts | 2025-01-09 | Hosting infra seller miscategorized. Deposit = 0 RUB (caution). May still be useful for hosting deals. |

## Sellers without Telegram

None — all 10 sellers had a Telegram contact reachable.

## Format key

- `@handle` → direct Telegram username (https://t.me/handle)
- `t.me/+...` → invite link to a private channel
- "channel" → broadcast / news only, not 1:1 chat

## Reproduce

Listings: `curl -A "Mozilla/5.0" https://rents.ws/search/categories/discord` (single page, ~167 KB, 10 sellers).
Each seller's TG was scraped from the external site listed in column "External site" (typically `<shop>/contacts` or homepage footer).
