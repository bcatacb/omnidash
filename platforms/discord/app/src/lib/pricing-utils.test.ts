import { describe, expect, it } from 'vitest'
import { getAccountSlotsLeft, recommendPlanForVolume } from './pricing-utils'

describe('recommendPlanForVolume', () => {
  const plans = [
    { slug: 'launch', name: 'Growth', account_slot_limit: 15, monthly_safe_messages_min: 2250, monthly_safe_messages_max: 4500, is_custom: false },
    { slug: 'growth', name: 'Elite', account_slot_limit: 40, monthly_safe_messages_min: 6000, monthly_safe_messages_max: 12000, is_custom: false },
    { slug: 'scale', name: 'Scale', account_slot_limit: 100, monthly_safe_messages_min: 15000, monthly_safe_messages_max: 30000, is_custom: false },
    { slug: 'enterprise', name: 'Custom', account_slot_limit: null, monthly_safe_messages_min: null, monthly_safe_messages_max: null, is_custom: true },
  ]

  it('recommends the first plan that safely covers the requested volume', () => {
    expect(recommendPlanForVolume(plans, 4000)?.slug).toBe('launch')
    expect(recommendPlanForVolume(plans, 9000)?.slug).toBe('growth')
    expect(recommendPlanForVolume(plans, 25000)?.slug).toBe('scale')
  })

  it('falls back to custom when the requested volume exceeds standard plans', () => {
    expect(recommendPlanForVolume(plans, 50000)?.slug).toBe('enterprise')
  })
})

describe('getAccountSlotsLeft', () => {
  it('returns remaining slots for capped plans', () => {
    expect(getAccountSlotsLeft(15, 4)).toBe(11)
    expect(getAccountSlotsLeft(15, 18)).toBe(0)
  })

  it('returns null for uncapped custom plans', () => {
    expect(getAccountSlotsLeft(null, 50)).toBeNull()
  })
})
