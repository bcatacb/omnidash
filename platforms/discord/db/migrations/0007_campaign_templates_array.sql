-- 0007_campaign_templates_array.sql
--
-- v0.11: replace tenant_main.campaigns.template (single text) with templates (text[]).
-- Engine picks a random template per send → message variety → less ban risk from
-- pattern-matching anti-spam.
--
-- Backwards-compatible: existing campaigns' single template becomes a 1-element array.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'tenant_main'
       AND table_name   = 'campaigns'
       AND column_name  = 'template'
  ) THEN
    ALTER TABLE tenant_main.campaigns ADD COLUMN IF NOT EXISTS templates text[] NOT NULL DEFAULT '{}';
    UPDATE tenant_main.campaigns
       SET templates = ARRAY[template]
     WHERE template IS NOT NULL
       AND template <> ''
       AND (templates IS NULL OR cardinality(templates) = 0);
    ALTER TABLE tenant_main.campaigns DROP COLUMN template;
  ELSE
    -- Fresh DB: just add the column.
    ALTER TABLE tenant_main.campaigns ADD COLUMN IF NOT EXISTS templates text[] NOT NULL DEFAULT '{}';
  END IF;
END
$$;
