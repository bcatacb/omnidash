-- 0002_tenant_schema_template.sql
--
-- Defines public.create_tenant_schema(text) which provisions a new
-- per-tenant schema and the six tables that live inside it:
--   discord_accounts, leads, conversations, messages, templates, audit_log
--
-- Spec: docs/superpowers/specs/2026-05-18-discord-unibox-design.md §6
--
-- Run order: AFTER 0001_shared_init.sql.
-- Idempotency: safe to re-run. The function uses CREATE SCHEMA IF NOT
-- EXISTS and CREATE TABLE IF NOT EXISTS throughout. The function
-- itself is replaced via CREATE OR REPLACE FUNCTION.
--
-- Usage:
--   SELECT public.create_tenant_schema('acme');
-- This creates the schema `tenant_acme` and all of its tables.
-- The caller is expected to have already inserted the corresponding
-- row into public.tenants with the same slug.

CREATE OR REPLACE FUNCTION public.create_tenant_schema(tenant_slug text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  schema_name text;
BEGIN
  -- Defensive: enforce the same slug shape as public.tenants.
  IF tenant_slug !~ '^[a-z0-9][a-z0-9-]{1,39}$' THEN
    RAISE EXCEPTION 'invalid tenant slug %', tenant_slug
      USING HINT = 'must match ^[a-z0-9][a-z0-9-]{1,39}$';
  END IF;

  schema_name := 'tenant_' || tenant_slug;

  -- Create the schema itself.
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

  --------------------------------------------------------------------
  -- discord_accounts
  --   One row per Discord user account bridged into this tenant.
  --   `bridge_container_id` is the docker container name running this
  --   account's mautrix-discord. `status` reflects the bridge's
  --   connection state as surfaced via the status_endpoint.
  --   `token_encrypted` is opaque to the API; the actual Discord
  --   user token lives inside the bridge container's own DB and is
  --   only mirrored here for backup if/when v2 export ships.
  --------------------------------------------------------------------
  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS %I.discord_accounts (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      label                 text,
      bridge_container_id   text UNIQUE,
      proxy_id              text,
      status                text NOT NULL DEFAULT 'provisioning',
      token_encrypted       text,
      last_status_at        timestamptz,
      created_at            timestamptz NOT NULL DEFAULT now()
    )
  $ddl$, schema_name);

  --------------------------------------------------------------------
  -- leads
  --   A Discord user the operator wants to (or has) contacted.
  --   `discord_user_id` is Discord's snowflake stored as text.
  --   `fr_status` and `dm_status` drive the lifecycle described in
  --   the spec §3.
  --------------------------------------------------------------------
  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS %I.leads (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      discord_user_id       text NOT NULL,
      display_name          text,
      source                text,
      label                 text,
      fr_status             text NOT NULL DEFAULT 'none',
      dm_status             text NOT NULL DEFAULT 'none',
      notes                 text,
      assigned_account_id   uuid REFERENCES %I.discord_accounts(id) ON DELETE SET NULL,
      created_at            timestamptz NOT NULL DEFAULT now()
    )
  $ddl$, schema_name, schema_name);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS leads_discord_user_id_idx ON %I.leads (discord_user_id)',
    schema_name);

  --------------------------------------------------------------------
  -- conversations
  --   One row per (account, peer_user_id). `channel_type` is one of
  --   'dm' / 'group_dm' / 'guild_text'. `unread_count` is maintained
  --   by the API, not the bridge.
  --------------------------------------------------------------------
  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS %I.conversations (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id        uuid NOT NULL REFERENCES %I.discord_accounts(id) ON DELETE CASCADE,
      peer_user_id      text NOT NULL,
      channel_type      text,
      last_message_at   timestamptz,
      unread_count      integer NOT NULL DEFAULT 0,
      label             text,
      UNIQUE (account_id, peer_user_id)
    )
  $ddl$, schema_name, schema_name);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS conversations_account_id_idx ON %I.conversations (account_id)',
    schema_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS conversations_last_message_at_idx ON %I.conversations (last_message_at DESC)',
    schema_name);

  --------------------------------------------------------------------
  -- messages
  --   One row per individual message. `direction` IN ('in','out').
  --   `discord_message_id` is the Discord snowflake; nullable for
  --   outbound messages we've optimistically inserted before the
  --   bridge ack. `delivery_status`: sent / pending / failed / deleted.
  --------------------------------------------------------------------
  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS %I.messages (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id     uuid NOT NULL REFERENCES %I.conversations(id) ON DELETE CASCADE,
      direction           text NOT NULL CHECK (direction IN ('in','out')),
      body                text,
      discord_message_id  text,
      sent_at             timestamptz NOT NULL DEFAULT now(),
      delivery_status     text NOT NULL DEFAULT 'sent'
    )
  $ddl$, schema_name, schema_name);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS messages_conv_sent_idx ON %I.messages (conversation_id, sent_at)',
    schema_name);

  --------------------------------------------------------------------
  -- templates
  --   Saved snippets for FRs and replies. `vars` is a list of
  --   placeholder names like {'first_name','project'}; the API
  --   substitutes them at send time.
  --------------------------------------------------------------------
  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS %I.templates (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text,
      body        text,
      vars        text[],
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  $ddl$, schema_name);

  --------------------------------------------------------------------
  -- audit_log
  --   Append-only log of state-changing operator actions: FR sent,
  --   message sent, account paused, lead status changed, etc.
  --   `actor_user_id` is uuid but not a hard FK — operators in
  --   `public.users` can be deleted while we still want to retain
  --   the trail. `payload` is freeform jsonb.
  --------------------------------------------------------------------
  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS %I.audit_log (
      id              bigserial PRIMARY KEY,
      actor_user_id   uuid,
      action          text NOT NULL,
      payload         jsonb,
      ts              timestamptz NOT NULL DEFAULT now()
    )
  $ddl$, schema_name);

END
$fn$;

COMMENT ON FUNCTION public.create_tenant_schema(text) IS
  'Provisions a new tenant_<slug> schema and its six tables. Idempotent.';
