-- Add inter_send_seconds to fr_campaigns (was missing from 0028).
ALTER TABLE tenant_main.fr_campaigns
  ADD COLUMN IF NOT EXISTS inter_send_seconds int NOT NULL DEFAULT 60;
