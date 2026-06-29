-- Per-account TOTP secret for server-side 2FA auto-fill during manual login.
ALTER TABLE tiktok_accounts ADD COLUMN IF NOT EXISTS totp_secret text;
