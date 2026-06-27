-- 0024_content_library.sql — quick-access content library for the unibox.

SET search_path TO tenant_main, public;

CREATE TABLE IF NOT EXISTS content_library (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text,
  text_body   text,
  image_url   text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
