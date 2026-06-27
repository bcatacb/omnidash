import { describe, expect, it } from 'vitest'

import { aggregateGroups, formatAccountSummary } from './groups'

describe('aggregateGroups', () => {
  it('deduplicates the same group across multiple accounts and combines account metadata', () => {
    const rows = aggregateGroups([
      {
        id: '10001',
        name: 'Alpha Crew',
        accountId: 'acc-1',
        accountUsername: 'alice',
        membersCount: 100,
        type: 'group',
        username: 'alpha',
        lastMessage: 'one',
        lastMessageDate: '2026-04-24T10:00:00.000Z',
      },
      {
        id: '10001',
        name: 'Alpha Crew',
        accountId: 'acc-2',
        accountUsername: 'bob',
        membersCount: 100,
        type: 'group',
        username: 'alpha',
        lastMessage: 'two',
        lastMessageDate: '2026-04-24T11:00:00.000Z',
      },
      {
        id: '10002',
        name: 'Beta Crew',
        accountId: 'acc-1',
        accountUsername: 'alice',
        membersCount: 25,
        type: 'channel',
        username: 'beta',
        lastMessage: 'beta',
        lastMessageDate: '2026-04-24T09:00:00.000Z',
      },
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      id: '10001',
      name: 'Alpha Crew',
      accountCount: 2,
      accountIds: ['acc-1', 'acc-2'],
      accountUsernames: ['alice', 'bob'],
      latestAccountUsername: 'alice',
    })
    expect(rows[0].lastMessage).toBe('two')
    expect(rows[1]).toMatchObject({
      id: '10002',
      accountCount: 1,
      accountIds: ['acc-1'],
      accountUsernames: ['alice'],
    })
  })

  it('formats a compact account summary for the UI', () => {
    expect(formatAccountSummary(['alice'])).toBe('alice')
    expect(formatAccountSummary(['alice', 'bob', 'carol'])).toBe('alice +2')
  })
})
