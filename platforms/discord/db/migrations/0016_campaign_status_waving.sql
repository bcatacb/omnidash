-- 0016_campaign_status_waving.sql
-- Expand the campaign status check constraint to include 'waving'.
SET search_path = tenant_main;

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'tenant_main.campaigns'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tenant_main.campaigns DROP CONSTRAINT %I', c);
  END IF;
END$$;

ALTER TABLE tenant_main.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft','waving','running','paused','finished'));
