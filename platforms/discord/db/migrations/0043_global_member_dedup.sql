-- 0043: enforce global uniqueness on discord_user_id in scraped_members
-- Previously the constraint was (job_id, discord_user_id), meaning the same
-- Discord user could appear in multiple scraper jobs and be pushed as leads twice.
-- We want each Discord user ID to appear at most once across all jobs.

-- Step 1: deduplicate — keep the oldest record per discord_user_id, delete the rest.
DELETE FROM tenant_main.scraped_members
WHERE id NOT IN (
  SELECT MIN(id) FROM tenant_main.scraped_members GROUP BY discord_user_id
);

-- Step 2: drop the old per-job unique constraint.
ALTER TABLE tenant_main.scraped_members
  DROP CONSTRAINT IF EXISTS scraped_members_job_id_discord_user_id_key;

-- Step 3: add a global unique constraint on discord_user_id.
ALTER TABLE tenant_main.scraped_members
  ADD CONSTRAINT scraped_members_discord_user_id_unique UNIQUE (discord_user_id);
