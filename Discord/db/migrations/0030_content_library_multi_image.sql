-- 0030_content_library_multi_image.sql
-- Upgrade content_library: single image_url → image_urls text array.
-- Also adds warmup_bank_presets for saving/loading reusable message banks.

SET search_path TO tenant_main, public;

-- Add array column (keep old for migration).
ALTER TABLE content_library ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';

-- Migrate any existing single URL into the array.
UPDATE content_library SET image_urls = ARRAY[image_url] WHERE image_url IS NOT NULL AND image_urls = '{}';

-- Drop old column.
ALTER TABLE content_library DROP COLUMN IF EXISTS image_url;

-- Warmup message bank presets: saved sets of spintax messages operators can reuse.
CREATE TABLE IF NOT EXISTS warmup_bank_presets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  messages   text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
