import PricingSection from "@/components/ui/pricing"
import PublicSiteShell from "@/components/public/PublicSiteShell"

export default function PricingPage() {
  return (
    <PublicSiteShell>
      <section className="border-b border-[hsl(var(--border))] bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(244,249,255,1)_100%)]">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 md:py-20">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[hsl(var(--primary))]">Pricing</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
              Telegram outreach pricing for agencies, founders, and sales teams
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-slate-600">
              Start at $100/month for 15 Telegram accounts, then add another 15 accounts for each extra $50.
              Built around a safe range of about 1-10 messages per Telegram account per day.
            </p>
          </div>
        </div>
      </section>
      <PricingSection />
    </PublicSiteShell>
  )
}
