-- 0001_shared_init.sql
--
-- Shared `public` schema for Discord Unibox.
-- Creates `public.tenants` and `public.users`.
--
-- Modeled on the Telegram SaaS at /root/tg-messaging-saas/ but reshaped
-- around schema-per-tenant multi-tenancy. See:
--   docs/superpowers/specs/2026-05-18-discord-unibox-design.md §6
--
-- Run order: FIRST. Must precede 0002.
-- Idempotency: safe to re-run; all CREATE statements use IF NOT EXISTS.

-- Required for gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;

------------------------------------------------------------------------
-- Tenants
------------------------------------------------------------------------
-- One row per customer organisation. The `slug` is the unique stable
-- identifier we use to derive per-tenant schema names: a tenant with
-- slug `acme` owns the `tenant_acme` schema. The slug is also exposed
-- in URLs (e.g. /t/acme/unibox) so it must be URL-safe.
CREATE TABLE IF NOT EXISTS public.tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  plan        text NOT NULL DEFAULT 'free',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Slug shape constraint: lowercase alphanumerics + hyphens, 2..40 chars.
-- Keeps us safe to interpolate into schema names without escaping.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_slug_shape'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_slug_shape
      CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$');
  END IF;
END
$$;

------------------------------------------------------------------------
-- Users
------------------------------------------------------------------------
-- Operator-side login. Every user belongs to exactly one tenant.
-- Email is unique *within* a tenant, not globally — different orgs
-- can have admins with the same personal email.
CREATE TABLE IF NOT EXISTS public.users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email          text NOT NULL,
  password_hash  text,
  role           text NOT NULL DEFAULT 'admin',
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz,
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON public.users (tenant_id);
