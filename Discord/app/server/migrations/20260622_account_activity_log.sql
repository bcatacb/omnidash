-- Account activity log: one row per notable action per account.
-- Used by the Health tab to track FR sends, DM sends, warmup sends,
-- scrape sessions, 4004 events, and quarantines so the operator can
-- see which accounts are overloaded and should be rested.
CREATE TABLE IF NOT EXISTS tenant_main.account_activity_log (
  id         bigserial    PRIMARY KEY,
  account_id text         NOT NULL,
  action     text         NOT NULL,
  detail     jsonb        NOT NULL DEFAULT '{}',
  ts         timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_activity_log_account_ts
  ON tenant_main.account_activity_log (account_id, ts DESC);

CREATE INDEX IF NOT EXISTS account_activity_log_ts
  ON tenant_main.account_activity_log (ts DESC);

CREATE INDEX IF NOT EXISTS account_activity_log_action_ts
  ON tenant_main.account_activity_log (action, ts DESC);
