import { describe, expect, it } from 'vitest';
import { formatCampaignLeadRange, getCampaignLeadStatusOptions, normalizeCampaignLeadPage } from './campaign-leads';

describe('campaign leads helpers', () => {
  it('formats the current visible row range', () => {
    expect(formatCampaignLeadRange({ page: 1, pageSize: 250, total: 2681, count: 250 })).toBe('Showing 1-250 of 2,681');
    expect(formatCampaignLeadRange({ page: 3, pageSize: 250, total: 2681, count: 250 })).toBe('Showing 501-750 of 2,681');
    expect(formatCampaignLeadRange({ page: 11, pageSize: 250, total: 2681, count: 181 })).toBe('Showing 2501-2681 of 2,681');
  });

  it('normalizes invalid page values back to page 1', () => {
    expect(normalizeCampaignLeadPage(0)).toBe(1);
    expect(normalizeCampaignLeadPage(-5)).toBe(1);
    expect(normalizeCampaignLeadPage(4)).toBe(4);
  });

  it('returns stable status options with page-specific additions appended once', () => {
    expect(getCampaignLeadStatusOptions(['sent', 'new', 'failed', 'replied', 'sent'])).toEqual([
      'new',
      'queued',
      'contacted',
      'sent',
      'replied',
      'failed',
    ]);
  });

  it('deduplicates status options case-insensitively and ignores blanks', () => {
    expect(getCampaignLeadStatusOptions([' Sent ', 'paused', 'sent', '', undefined, 'queued'])).toEqual([
      'new',
      'queued',
      'contacted',
      'sent',
      'replied',
      'failed',
      'paused',
    ]);
  });
});
