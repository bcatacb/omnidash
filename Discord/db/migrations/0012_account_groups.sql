-- 0012_account_groups.sql
-- Operator-created groupings of captured Discord accounts for the GG browser
-- extension. A group is the unit the extension fetches as a token bundle and
-- renders as a row of "Activate" buttons.
SET search_path = tenant_main;

CREATE TABLE IF NOT EXISTS account_groups (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  -- Operator notes, e.g. "Poker outreach pool" or "Gaming socials".
  description text DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_group_members (
  group_id   text NOT NULL REFERENCES account_groups(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  -- Display order within the group's UI row. Lower = leftmost.
  position   int  NOT NULL DEFAULT 0,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_agm_account ON account_group_members(account_id);
