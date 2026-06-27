# db/migrations

SQL migrations for the Discord Unibox Postgres database. The data model
is fully specified in
[`docs/superpowers/specs/2026-05-18-discord-unibox-design.md`](../../docs/superpowers/specs/2026-05-18-discord-unibox-design.md)
§6 — these files are the executable form.

## Files

| File | Purpose |
|------|---------|
| `0001_shared_init.sql` | Creates the shared `public` schema: `public.tenants`, `public.users`. |
| `0002_tenant_schema_template.sql` | Defines `public.create_tenant_schema(slug)` which provisions a per-tenant `tenant_<slug>` schema with all six tables. |

## Running them

### Plain psql

Run in order against a fresh database:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0001_shared_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0002_tenant_schema_template.sql
```

To provision a new tenant after migrations are applied:

```sql
INSERT INTO public.tenants (slug, plan) VALUES ('acme', 'free');
SELECT public.create_tenant_schema('acme');
```

The order matters only for cleanliness — the function does not read
`public.tenants`. But our API code does, so insert the tenant row first.

### Supabase CLI

If we end up on Supabase (the TG SaaS is), the same files can be
dropped into `supabase/migrations/` with a timestamp prefix:

```
supabase/migrations/
  20260518000001_shared_init.sql       <- contents of 0001
  20260518000002_tenant_schema_template.sql  <- contents of 0002
```

Then `supabase db push` runs them in lexicographic order.

## Naming convention for future migrations

- **Sequential numeric prefix**, zero-padded to 4 digits: `0003_…sql`,
  `0004_…sql`. We do not use date prefixes here; the API itself
  applies migrations in lexicographic order at boot, and zero-padded
  integers keep the sort stable forever.
- Snake_case description after the prefix, e.g.
  `0003_add_templates_owner_user_id.sql`.
- One logical change per file. Don't bundle "add column" with
  "rename table" — splitting them keeps rollbacks cheap.
- If a migration changes the per-tenant schema, it must also include
  a loop that applies the same change to every existing
  `tenant_<slug>` schema. Pattern:

  ```sql
  DO $$
  DECLARE r record;
  BEGIN
    FOR r IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\_%' ESCAPE '\' LOOP
      EXECUTE format('ALTER TABLE %I.leads ADD COLUMN IF NOT EXISTS owner_id uuid', r.nspname);
    END LOOP;
  END
  $$;
  ```

  And update `0002_tenant_schema_template.sql` so future tenants get
  the new column at provisioning time.

## Idempotency notes

Every statement in `0001` and `0002` uses `IF NOT EXISTS` or
`CREATE OR REPLACE`. Re-running the full set against a populated
database is safe and is the assumed boot-time behaviour of the API.
The check constraint on `public.tenants.slug` is wrapped in a
`DO $$` block guarded against duplicate adds.

A migration is only "applied" once it has run to completion without
error. There is no separate migrations-history table yet — the API
agent (A) decides whether to add one (`public.schema_migrations`)
or rely purely on idempotent re-runs. Either is fine, but pick one
before we have a second engineer.
