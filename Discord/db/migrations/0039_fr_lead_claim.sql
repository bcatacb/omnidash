-- v2.0.35: advisory claim column on FR leads.
--
-- An atomic UPDATE...RETURNING on claimed_at lets a worker take exclusive
-- ownership of a lead for the duration of a send (which can take 30-120s when a
-- captcha solve is involved). A second tick/process can't grab the same lead
-- and double-send a friend request / DM to the same person — a strong spam
-- signal. claimed_at is advisory only: status and next_eligible_at remain the
-- authoritative gates; a claim auto-expires after 5 minutes so a crash mid-send
-- can't permanently strand a lead.
ALTER TABLE tenant_main.fr_campaign_leads
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_fr_leads_claimed_at
  ON tenant_main.fr_campaign_leads (claimed_at);
