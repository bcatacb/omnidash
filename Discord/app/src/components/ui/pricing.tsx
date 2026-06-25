import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Briefcase, CheckCheck, Database, Server, SlidersHorizontal, Sparkles } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { recommendPlanForVolume } from "@/lib/pricing-utils"

type PlanRecord = {
  id?: string
  slug: string
  name: string
  description?: string | null
  price_monthly: number
  monthly_message_limit: number
  lead_limit: number
  features: string[]
  account_slot_limit: number | null
  monthly_safe_messages_min: number | null
  monthly_safe_messages_max: number | null
  is_custom?: boolean
}

const fallbackPlans: PlanRecord[] = [
  {
    slug: "launch",
    name: "Launch",
    description: "For teams getting started with structured Telegram outbound.",
    price_monthly: 100,
    monthly_message_limit: 4500,
    lead_limit: 10000,
    account_slot_limit: 15,
    monthly_safe_messages_min: 450,
    monthly_safe_messages_max: 4500,
    features: [
      "15 connected Telegram accounts",
      "Up to 4,500 safe monthly messages",
      "10,000 imported leads",
      "Core campaign management",
    ],
  },
  {
    slug: "growth",
    name: "Growth",
    description: "For agencies and operators scaling campaigns across more accounts.",
    price_monthly: 150,
    monthly_message_limit: 9000,
    lead_limit: 20000,
    account_slot_limit: 30,
    monthly_safe_messages_min: 900,
    monthly_safe_messages_max: 9000,
    features: [
      "30 connected Telegram accounts",
      "Up to 9,000 safe monthly messages",
      "20,000 imported leads",
      "Advanced automations and analytics",
    ],
  },
  {
    slug: "scale",
    name: "Scale",
    description: "For larger teams that need more accounts, volume, and support.",
    price_monthly: 200,
    monthly_message_limit: 13500,
    lead_limit: 30000,
    account_slot_limit: 45,
    monthly_safe_messages_min: 1350,
    monthly_safe_messages_max: 13500,
    features: [
      "45 connected Telegram accounts",
      "Up to 13,500 safe monthly messages",
      "30,000 imported leads",
      "Priority support and onboarding",
    ],
  },
  {
    slug: "enterprise",
    name: "Custom",
    description: "For teams that need more infrastructure, custom limits, or managed onboarding.",
    price_monthly: 0,
    monthly_message_limit: 0,
    lead_limit: 0,
    account_slot_limit: null,
    monthly_safe_messages_min: null,
    monthly_safe_messages_max: null,
    is_custom: true,
    features: [
      "Unlimited or custom account slots",
      "Custom sending volume and infrastructure review",
      "Dedicated onboarding",
      "Custom limits, reporting, and support",
    ],
  },
]

const normalizePlanRecord = (plan: PlanRecord): PlanRecord => {
  if (plan.slug === "launch") {
    return {
      ...plan,
      name: "Launch",
      price_monthly: 100,
      monthly_message_limit: 4500,
      lead_limit: 10000,
      description: "For teams getting started with structured Telegram outbound.",
      account_slot_limit: 15,
      monthly_safe_messages_min: 450,
      monthly_safe_messages_max: 4500,
      features: [
        "15 connected Telegram accounts",
        "Up to 4,500 safe monthly messages",
        "10,000 imported leads",
        "Core campaign management",
      ],
    }
  }

  if (plan.slug === "growth") {
    return {
      ...plan,
      name: "Growth",
      price_monthly: 150,
      monthly_message_limit: 9000,
      lead_limit: 20000,
      description: "For agencies and operators scaling campaigns across more accounts.",
      account_slot_limit: 30,
      monthly_safe_messages_min: 900,
      monthly_safe_messages_max: 9000,
      features: [
        "30 connected Telegram accounts",
        "Up to 9,000 safe monthly messages",
        "20,000 imported leads",
        "Advanced automations and analytics",
      ],
    }
  }

  if (plan.slug === "scale") {
    return {
      ...plan,
      name: "Scale",
      price_monthly: 200,
      monthly_message_limit: 13500,
      lead_limit: 30000,
      description: "For larger teams that need more accounts, volume, and support.",
      account_slot_limit: 45,
      monthly_safe_messages_min: 1350,
      monthly_safe_messages_max: 13500,
      features: [
        "45 connected Telegram accounts",
        "Up to 13,500 safe monthly messages",
        "30,000 imported leads",
        "Priority support and onboarding",
      ],
    }
  }

  if (plan.slug === "enterprise" || plan.is_custom) {
    return {
      ...plan,
      name: "Custom",
      price_monthly: 0,
      monthly_message_limit: 0,
      lead_limit: 0,
      description: "For teams that need more infrastructure, custom limits, or managed onboarding.",
      account_slot_limit: null,
      monthly_safe_messages_min: null,
      monthly_safe_messages_max: null,
      is_custom: true,
      features: [
        "Unlimited or custom account slots",
        "Custom sending volume and infrastructure review",
        "Dedicated onboarding",
        "Custom limits, reporting, and support",
      ],
    }
  }

  return plan
}

const formatNumber = (value: number | null | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "—"
  return value.toLocaleString()
}

const featureIcon = (index: number) => {
  if (index === 0) return <Briefcase size={20} />
  if (index === 1) return <Server size={20} />
  return <Database size={20} />
}

export default function PricingSection() {
  const [plans, setPlans] = useState<PlanRecord[]>(fallbackPlans)
  const [desiredMessages, setDesiredMessages] = useState(4000)
  const [recommendationsEnabled, setRecommendationsEnabled] = useState(true)

  useEffect(() => {
    const loadPlans = async () => {
      try {
        const [plansRes, meRes] = await Promise.all([
          fetch("/api/auth/plans"),
          fetch("/api/auth/me"),
        ])

        if (plansRes.ok) {
          const planData = await plansRes.json()
          if (Array.isArray(planData) && planData.length > 0) {
            setPlans(planData.map((plan: PlanRecord) => normalizePlanRecord(plan)).sort((a, b) => {
              if (a.is_custom && !b.is_custom) return 1
              if (!a.is_custom && b.is_custom) return -1
              return a.price_monthly - b.price_monthly
            }))
          }
        }

        if (meRes.ok) {
          const me = await meRes.json()
          setRecommendationsEnabled(me?.preferences?.plan_recommendations_enabled !== false)
        }
      } catch (error) {
        console.error("Failed to load pricing context", error)
      }
    }

    loadPlans()
  }, [])

  const standardPlans = useMemo(() => plans.filter((plan) => !plan.is_custom), [plans])
  const customPlan = useMemo(() => plans.find((plan) => plan.is_custom) || null, [plans])
  const recommendedPlan = useMemo(() => recommendPlanForVolume(plans, desiredMessages), [plans, desiredMessages])

  return (
    <section id="pricing" className="mx-auto max-w-7xl px-4 py-20">
      <article className="mb-6 max-w-4xl space-y-4 text-left">
        <p className="text-[12px] font-black uppercase tracking-[0.24em] text-[#8B5E00]">Telegram outreach pricing</p>
        <h2 className="text-4xl font-medium capitalize text-gray-900 md:text-6xl">Pricing starts at $100/month for 15 Telegram accounts</h2>
        <p className="max-w-3xl text-sm text-gray-600 md:text-base">
          Pricing starts at <strong>$100/month for 15 Telegram accounts</strong> and increases by <strong>$50 for every additional 15 accounts</strong>.
          Based on a safe sending range of roughly <strong>1-10 messages per Telegram account per day</strong>, the entry package supports up to about <strong>450-4,500 messages per month</strong>.
        </p>
      </article>

      {recommendationsEnabled && (
        <Card className="mb-8 border border-orange-200 bg-gradient-to-br from-orange-50 to-white shadow-sm">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.24em] text-[#8B5E00]">
              <SlidersHorizontal className="h-4 w-4" />
              Volume calculator
            </div>
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-2xl font-semibold text-gray-900">How many Telegram messages do you want to send per month?</h3>
                <p className="mt-2 text-sm text-gray-600">
                  Slide your target volume and we’ll recommend the best-fit plan based on safe sending ranges of roughly 1-10 messages per account per day.
                </p>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[12px] font-black uppercase tracking-[0.18em] text-[#8B5E00]">Target volume</div>
                <div className="text-3xl font-black text-[#111827]">{desiredMessages.toLocaleString()}</div>
                <div className="text-xs text-gray-500">messages / month</div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <input
              type="range"
              min={500}
              max={50000}
              step={250}
              value={desiredMessages}
              onChange={(event) => setDesiredMessages(Number(event.target.value))}
              className="w-full accent-orange-500"
            />
            {recommendedPlan && (
              <div className="grid gap-4 rounded-3xl border border-orange-200 bg-white p-5 md:grid-cols-[1.2fr_0.8fr]">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-[12px] font-black uppercase tracking-[0.18em] text-[#8B5E00]">
                    <Sparkles className="h-4 w-4" />
                    Recommended: {recommendedPlan.name}
                  </div>
                  <p className="mt-3 text-sm leading-7 text-gray-700">
                    {recommendedPlan.is_custom
                      ? "You’re above the standard packaged range, so a custom plan is the right fit for your volume and account footprint."
                      : `${recommendedPlan.name} gives you ${formatNumber(recommendedPlan.account_slot_limit)} account slots and a safe monthly window of ${formatNumber(recommendedPlan.monthly_safe_messages_min)}-${formatNumber(recommendedPlan.monthly_safe_messages_max)} messages.`}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#11100C] p-5 text-white">
                  <div className="text-[12px] font-black uppercase tracking-[0.18em] text-[#FFD166]">Suggested plan</div>
                  <div className="mt-2 text-3xl font-black">{recommendedPlan.is_custom ? "Custom" : `$${recommendedPlan.price_monthly}`}</div>
                  <div className="text-sm text-white/70">{recommendedPlan.is_custom ? "Talk to sales" : "per month"}</div>
                  <div className="mt-4 text-sm text-white/80">
                    {recommendedPlan.is_custom
                      ? "For teams that need custom scale, infrastructure, or onboarding support."
                      : `${formatNumber(recommendedPlan.account_slot_limit)} accounts × 1-10/day = ${formatNumber(recommendedPlan.monthly_safe_messages_min)}-${formatNumber(recommendedPlan.monthly_safe_messages_max)}/month`}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 py-6 md:grid-cols-4">
        {standardPlans.map((plan) => {
          const recommended = recommendedPlan?.slug === plan.slug
          return (
            <Card
              key={plan.slug}
              className={cn(
                "relative border border-neutral-200 bg-white",
                recommended ? "ring-2 ring-orange-500 bg-orange-50" : ""
              )}
            >
              <CardHeader className="text-left">
                <div className="flex justify-between gap-4">
                  <h3 className="text-3xl font-semibold text-gray-900 md:text-2xl xl:text-3xl">{plan.name}</h3>
                  {recommended && <span className="h-fit rounded-full bg-orange-500 px-3 py-1 text-sm font-medium text-white">Recommended</span>}
                </div>
                <p className="text-sm text-gray-600 md:text-xs xl:text-sm">{plan.description}</p>
                <div className="flex items-baseline">
                  <span className="text-4xl font-semibold text-gray-900">${plan.price_monthly}</span>
                  <span className="ml-1 text-gray-600">/month</span>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                <Link
                  to={`/signup?plan=${plan.slug}`}
                  className={cn(
                    "mb-6 flex w-full items-center justify-center rounded-xl p-4 text-xl",
                    recommended
                      ? "border border-orange-400 bg-gradient-to-t from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500"
                      : "border border-neutral-700 bg-gradient-to-t from-neutral-900 to-neutral-600 text-white shadow-lg shadow-neutral-900"
                  )}
                >
                  Get started
                </Link>

                <div className="space-y-3 border-t border-neutral-200 pt-4">
                  <h2 className="text-xl font-semibold uppercase text-gray-900">Features</h2>
                  <div className="grid gap-2">
                    {plan.features.map((feature, index) => (
                      <div key={feature} className="flex items-center gap-3 rounded-xl bg-white/70 p-3 text-sm font-semibold text-gray-700">
                        <span className="text-orange-500">{featureIcon(index)}</span>
                        {feature}
                      </div>
                    ))}
                  </div>
                  {typeof plan.account_slot_limit === "number" && (
                    <div className="rounded-2xl bg-[#F8F4EA] p-4 text-sm text-[#625B4E]">
                      <div className="font-black text-[#111827]">How we calculate safe volume</div>
                      <div className="mt-1">
                        {plan.account_slot_limit} accounts × 1-10 messages/day × 30 days = {formatNumber(plan.monthly_safe_messages_min)}-{formatNumber(plan.monthly_safe_messages_max)} safe monthly messages.
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}

        {customPlan && (
          <Card className="relative border border-dashed border-neutral-300 bg-[#11100C] text-white">
            <CardHeader className="text-left">
              <div className="flex justify-between gap-4">
                <h3 className="text-3xl font-semibold md:text-2xl xl:text-3xl">{customPlan.name}</h3>
                <span className="h-fit rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white">Talk to sales</span>
              </div>
              <p className="text-sm text-white/70">{customPlan.description}</p>
              <div className="flex items-baseline">
                <span className="text-4xl font-semibold">Custom</span>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <Link
                to="/signin"
                className="mb-6 flex w-full items-center justify-center rounded-xl border border-white/20 bg-white/10 p-4 text-xl text-white shadow-lg shadow-black/20"
              >
                Contact us
              </Link>
              <div className="space-y-3 border-t border-white/10 pt-4">
                <h2 className="text-xl font-semibold uppercase">What’s included</h2>
                <ul className="space-y-2 font-semibold">
                  {customPlan.features.map((feature) => (
                    <li key={feature} className="flex items-center">
                      <span className="mr-3 grid h-6 w-6 place-content-center rounded-full border border-orange-400 bg-white/10">
                        <CheckCheck className="h-4 w-4 text-orange-300" />
                      </span>
                      <span className="text-sm text-white/80">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  )
}
