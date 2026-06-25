CREATE TABLE IF NOT EXISTS public.user_custom_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status_key text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, status_key)
);

CREATE INDEX IF NOT EXISTS idx_user_custom_statuses_user_id
  ON public.user_custom_statuses(user_id);

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Default key',
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id
  ON public.api_keys(user_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_revoked_at
  ON public.api_keys(revoked_at);
