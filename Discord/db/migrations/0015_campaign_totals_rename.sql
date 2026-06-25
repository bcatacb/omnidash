-- 0015_campaign_totals_rename.sql
-- Rename totals_accepted → totals_replied and totals_declined → totals_failed.
SET search_path = tenant_main;

ALTER TABLE tenant_main.campaigns RENAME COLUMN totals_accepted TO totals_replied;
ALTER TABLE tenant_main.campaigns RENAME COLUMN totals_declined TO totals_failed;
