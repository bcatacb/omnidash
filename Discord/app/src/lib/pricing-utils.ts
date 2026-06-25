export type VolumePlan = {
  slug: string
  name: string
  account_slot_limit: number | null
  monthly_safe_messages_min: number | null
  monthly_safe_messages_max: number | null
  is_custom?: boolean
}

export const getAccountSlotsLeft = (limit: number | null | undefined, used: number) => {
  if (limit === null || limit === undefined) return null
  return Math.max(0, limit - Math.max(0, used))
}

export const recommendPlanForVolume = <T extends VolumePlan>(plans: T[], desiredMessages: number) => {
  const normalizedDesired = Math.max(0, Number(desiredMessages) || 0)
  const standardPlans = plans.filter((plan) => !plan.is_custom)
  const customPlan = plans.find((plan) => plan.is_custom)

  const recommended = standardPlans.find((plan) => {
    const cap = plan.monthly_safe_messages_max
    return typeof cap === 'number' && normalizedDesired <= cap
  })

  return recommended || customPlan || plans[plans.length - 1] || null
}
