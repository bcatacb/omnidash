import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

const BASE = resolve(__dirname, '../../db/migrations');
const SERVER = resolve(__dirname, 'migrations');

const files = [
  '0001_shared_init.sql',
  '0002_tenant_schema_template.sql',
  '0003_sessions.sql',
];

const afterSchema = [
  '0004_align_with_code.sql',
  '0005_campaigns_leads.sql',
  '0006_campaign_mode.sql',
  '0007_campaign_templates_array.sql',
  '0008_last_message_direction.sql',
  '0009_inter_send_spacing.sql',
  '0010_campaign_mode_both.sql',
  '0011_scraped_guild_cache.sql',
  '0012_account_groups.sql',
  '0013_account_proxies.sql',
  '0014_lead_status_simplify.sql',
  '0015_campaign_totals_rename.sql',
  '0016_campaign_status_waving.sql',
  '0017_conversation_interested.sql',
  '0018_campaign_account_suspensions.sql',
  '0019_warmup_status.sql',
  '0020_warmup_servers_seed.sql',
  '0021_warmup_campaigns.sql',
  '0022_warmup_pair_pending_reply.sql',
  '0023_account_cached_email.sql',
  '0024_content_library.sql',
  '0025_campaign_global_spacing.sql',
  '0026_account_credentials.sql',
  '0028_fr_campaigns.sql',
  '0029_interval_settings.sql',
  '0030_content_library_multi_image.sql',
  '0031_rename_fr_columns.sql',
  '0032_fr_campaigns_inter_send.sql',
  '0033_warmup_daily_cap.sql',
  '0034_outreach_fr_gates.sql',
];

const serverFiles = [
  '20260407_auth_plans.sql',
  '20260410_user_custom_statuses_api_keys.sql',
];

async function migrate() {
  for (const f of files) {
    console.log(`  ${f}...`);
    await pool.query(readFileSync(resolve(BASE, f), 'utf-8'));
  }
  await pool.query('CREATE SCHEMA IF NOT EXISTS tenant_main');
  for (const f of afterSchema) {
    console.log(`  ${f}...`);
    await pool.query(readFileSync(resolve(BASE, f), 'utf-8'));
  }
  for (const f of serverFiles) {
    console.log(`  ${f}...`);
    await pool.query(readFileSync(resolve(SERVER, f), 'utf-8'));
  }
  await pool.query(`
    INSERT INTO public.tenants (slug, plan) VALUES ('main', 'enterprise')
    ON CONFLICT (slug) DO NOTHING;
    INSERT INTO public.users (tenant_id, email, role)
    SELECT id, 'admin@local.dev', 'admin'
    FROM public.tenants WHERE slug = 'main'
    ON CONFLICT (tenant_id, email) DO NOTHING;
  `);
  console.log('Done');
}

migrate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
