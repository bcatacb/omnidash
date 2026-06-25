-- 0013_account_proxies.sql
-- Per-account proxy assignment. When the GG extension activates an account
-- in the operator's real Chrome, it ALSO sets chrome.proxy.settings to the
-- account's assigned proxy (with bypassList so only discord.com routes
-- through it; gg.linktree.bond fetches stay direct).
--
-- Schema: a separate proxies table holds the operator's Webshare/etc pool,
-- and account_proxies maps each account to one proxy. Many accounts can
-- share a proxy (Webshare proxy-per-1-to-5 accounts is the sweet spot per
-- the proxy notes in memory).
SET search_path = tenant_main;

CREATE TABLE IF NOT EXISTS proxies (
  id            text PRIMARY KEY,
  -- Human label, e.g. "Webshare Sacramento #3"
  label         text NOT NULL DEFAULT '',
  -- Full proxy URL with embedded basic-auth, e.g. http://user:pass@1.2.3.4:5728
  url           text NOT NULL,
  -- Optional geo tag for UI display ("US-CA", "US-WA", etc)
  geo           text DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_proxies (
  account_id  text PRIMARY KEY,
  proxy_id    text NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ap_proxy ON account_proxies(proxy_id);
