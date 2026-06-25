-- v0.77: Stored credentials for auto-reauth on 4004 (token revoked).
-- Both columns use the same AES-256-GCM encryption as token_encrypted.
ALTER TABLE tenant_main.discord_accounts
  ADD COLUMN IF NOT EXISTS password_encrypted    bytea,
  ADD COLUMN IF NOT EXISTS totp_secret_encrypted bytea;
