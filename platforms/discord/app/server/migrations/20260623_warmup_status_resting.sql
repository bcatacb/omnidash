-- Add 'resting' to the warmup_status CHECK constraint.
-- 'resting' is a lightweight operator-triggered pause: the account's token
-- stays valid and gateway stays open — it is excluded from all send engines
-- until the operator clicks Activate, which sets the status back to 'outreach'.
ALTER TABLE tenant_main.discord_accounts
  DROP CONSTRAINT IF EXISTS discord_accounts_warmup_status_check;

ALTER TABLE tenant_main.discord_accounts
  ADD CONSTRAINT discord_accounts_warmup_status_check
    CHECK (warmup_status IN ('captured','warming','warmed','outreach','quarantined','retired','resting'));
