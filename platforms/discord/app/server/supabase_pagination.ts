export async function collectPagedRows<T>(
  loadPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const page = await loadPage(from, from + pageSize - 1);
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return rows;
}
