export type CampaignLeadPageResponse<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const DEFAULT_CAMPAIGN_LEAD_STATUSES = [
  'new',
  'queued',
  'contacted',
  'sent',
  'replied',
  'failed',
];

export function normalizeCampaignLeadPage(page: number) {
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

export function getCampaignLeadStatusOptions(statuses: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const options: string[] = [];

  for (const status of DEFAULT_CAMPAIGN_LEAD_STATUSES) {
    seen.add(status);
    options.push(status);
  }

  for (const status of statuses) {
    const normalized = String(status || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    options.push(normalized);
  }

  return options;
}

export function formatCampaignLeadRange(params: {
  page: number;
  pageSize: number;
  total: number;
  count: number;
}) {
  const { page, pageSize, total, count } = params;
  if (total <= 0 || count <= 0) return 'Showing 0 of 0';
  const start = (page - 1) * pageSize + 1;
  const end = start + count - 1;
  return `Showing ${start}-${end} of ${total.toLocaleString()}`;
}
