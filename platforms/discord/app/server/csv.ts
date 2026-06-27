// RFC 4180 CSV serialization. Quotes any field containing comma, quote, CR, or LF.
// Doubles embedded quotes. null/undefined become empty cells. Other values are String()'d.

const NEEDS_QUOTING = /[",\r\n]/;

export const escapeCsvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  if (!NEEDS_QUOTING.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
};

export const buildCsv = (headers: string[], rows: Array<Array<unknown>>): string => {
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvCell).join(','));
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
};
