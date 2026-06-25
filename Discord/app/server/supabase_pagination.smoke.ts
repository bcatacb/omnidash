const assert = require('node:assert/strict');
const { collectPagedRows }: {
  collectPagedRows: <T>(
    loadPage: (from: number, to: number) => Promise<T[]>,
    pageSize?: number
  ) => Promise<T[]>;
} = require('./supabase_pagination.ts');

async function main() {
  let calls = 0;
  const rows = await collectPagedRows<number>(async (from: number, to: number) => {
    calls += 1;
    assert.equal(to - from, 1);
    if (from === 0) return [1, 2];
    if (from === 2) return [3, 4];
    if (from === 4) return [5];
    return [];
  }, 2);

  assert.deepEqual(rows, [1, 2, 3, 4, 5]);
  assert.equal(calls, 3);
  console.log('supabase pagination smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
