-- v2.0.44 — preserve scraped members when a scraper job is deleted.
--
-- Previously scraped_members.job_id had ON DELETE CASCADE, which wiped all
-- scraped members the moment the operator deleted the job row (or the account
-- that owned the job was removed). Operators need to keep their member pool
-- intact so they can still export / push to campaigns even after cleanup.
--
-- Changes:
--   1. Make job_id nullable so SET NULL can fire (was NOT NULL).
--   2. Swap the FK from ON DELETE CASCADE → ON DELETE SET NULL.
--      Members whose job is deleted get job_id = NULL (orphaned but preserved).

ALTER TABLE tenant_main.scraped_members
  ALTER COLUMN job_id DROP NOT NULL;

ALTER TABLE tenant_main.scraped_members
  DROP CONSTRAINT IF EXISTS scraped_members_job_id_fkey;

ALTER TABLE tenant_main.scraped_members
  ADD CONSTRAINT scraped_members_job_id_fkey
    FOREIGN KEY (job_id)
    REFERENCES tenant_main.member_scraper_jobs(id)
    ON DELETE SET NULL;
