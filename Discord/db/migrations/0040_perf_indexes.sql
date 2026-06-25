-- v2.0.38: composite indexes for hot per-tick query paths.
--
-- - leads(assigned_account_id, dm_sent_at): countOutreachSendsToday /
--   countLeadsSentSince filter by account + dm_sent_at on every outreach tick.
-- - conversations(account_id, peer_discord_user_id): findExistingDmChannel /
--   findWarmDmChannel look up a DM by (account, peer) before each send.
-- - fr_campaign_leads(campaign_id, status, next_eligible_at): listEligibleFrLeads
--   selects pending, not-yet-eligible leads per FR tick.
CREATE INDEX IF NOT EXISTS idx_leads_account_sent
  ON tenant_main.leads (assigned_account_id, dm_sent_at);

CREATE INDEX IF NOT EXISTS idx_conversations_peer
  ON tenant_main.conversations (account_id, peer_discord_user_id);

CREATE INDEX IF NOT EXISTS idx_fr_leads_account_status
  ON tenant_main.fr_campaign_leads (campaign_id, status, next_eligible_at);
