-- 0023_account_cached_email.sql — persist Discord account email so it survives token revocation.

SET search_path TO tenant_main, public;

ALTER TABLE discord_accounts
  ADD COLUMN IF NOT EXISTS cached_email TEXT;
