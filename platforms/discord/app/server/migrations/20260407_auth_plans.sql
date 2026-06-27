DROP POLICY IF EXISTS users_select_own ON public.users;
DROP POLICY IF EXISTS users_insert_signup ON public.users;

CREATE POLICY users_select_own ON public.users
  FOR SELECT
  USING (true);

CREATE POLICY users_insert_signup ON public.users
  FOR INSERT
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  price_monthly integer NOT NULL,
  monthly_message_limit integer NOT NULL,
  lead_limit integer NOT NULL,
  description text,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'trialing',
  current_period_start timestamptz DEFAULT now(),
  current_period_end timestamptz DEFAULT (now() + interval '30 days'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

INSERT INTO public.subscription_plans (slug, name, price_monthly, monthly_message_limit, lead_limit, description, features)
VALUES
  ('launch', 'Launch', 37, 1000, 2500, 'Start Telegram outreach with conservative daily sending.',
   '["1,000 Telegram messages per month", "2,500 leads", "3 connected Telegram accounts", "Unibox and campaign analytics"]'::jsonb),
  ('growth', 'Growth', 77, 5000, 15000, 'Scale multi-account Telegram outreach for active teams.',
   '["5,000 Telegram messages per month", "15,000 leads", "10 connected Telegram accounts", "Campaign scheduling and lead imports", "AI personalization workspace"]'::jsonb),
  ('scale', 'Scale', 286, 10000, 50000, 'Higher-volume outreach with deeper reporting and controls.',
   '["10,000 Telegram messages per month", "50,000 leads", "25 connected Telegram accounts", "Priority campaign scheduling", "Advanced analytics and Unibox workflows"]'::jsonb),
  ('enterprise', 'Enterprise', 0, 0, 0, 'Custom limits, onboarding, and compliance review for large operators.',
   '["Custom Telegram message limits", "Custom lead limits", "Dedicated onboarding", "Custom infrastructure and safety review"]'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  price_monthly = EXCLUDED.price_monthly,
  monthly_message_limit = EXCLUDED.monthly_message_limit,
  lead_limit = EXCLUDED.lead_limit,
  description = EXCLUDED.description,
  features = EXCLUDED.features,
  updated_at = now();
