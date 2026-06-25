-- 0003_sessions.sql
--
-- Cookie-based session storage for the auth middleware.
-- One row per active browser session. Token is a random 32-byte hex string.
-- On signin we hash with SHA-256 before storing so a DB leak doesn't grant immediate
-- session-takeover.
--
-- Run order: AFTER 0001.
-- Idempotency: safe to re-run.

CREATE TABLE IF NOT EXISTS public.user_sessions (
  token_hash   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_agent   text,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON public.user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON public.user_sessions (expires_at);
