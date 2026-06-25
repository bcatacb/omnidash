-- 0014_lead_status_simplify.sql
-- Replace the multi-value LeadFrStatus enum with the simpler LeadStatus.
-- Values: pending (waiting for engine to pick up), waving (operator manually
-- waving in their Discord client to warm the channel), sent (DM sent through
-- warm channel), replied (inbound message received), failed (any error).
SET search_path = tenant_main;

-- Drop the existing check constraint (name is auto-generated; find it dynamically).
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'tenant_main.leads'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%fr_status%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tenant_main.leads DROP CONSTRAINT %I', c);
  END IF;
END$$;

-- Migrate values.
UPDATE tenant_main.leads SET fr_status = 'replied' WHERE fr_status = 'accepted';
UPDATE tenant_main.leads SET fr_status = 'failed'  WHERE fr_status IN ('declined', 'expired', 'error', 'dm_blocked');

-- Rename column for clarity.
ALTER TABLE tenant_main.leads RENAME COLUMN fr_status TO status;

-- Add new check constraint.
ALTER TABLE tenant_main.leads
  ADD CONSTRAINT leads_status_check
  CHECK (status IN ('pending','waving','sent','replied','failed'));
