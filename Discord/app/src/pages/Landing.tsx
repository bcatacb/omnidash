import { Link } from "react-router-dom"
import {
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  MessagesSquare,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Users,
  Workflow,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import PublicSiteShell from "@/components/public/PublicSiteShell"

const logos = ["Acme", "Northstar", "Pixel", "Vertex", "Summit", "Flowly", "Aperture", "BluePeak"]

const heroPrompts = [
  "Build my Telegram outreach strategy",
  "Create an AI reply workflow",
  "Find leads from niche groups",
]

const productSections = [
  {
    eyebrow: "01",
    title: "Reach Clients On Autopilot",
    copy: "Use Droply AI to identify qualified prospects, organize sending accounts, and launch Telegram outreach that runs without manual chasing.",
    bullets: ["Lead sourcing", "Account rotation", "Automated follow-ups"],
    visualTitle: "Outbound pipeline",
    visualRows: [
      ["Qualified leads", "3,482"],
      ["Messages queued", "1,240"],
      ["Reply rate", "29.3%"],
    ],
  },
  {
    eyebrow: "02",
    title: "Automate Your Outreach",
    copy: "Create and launch Telegram campaigns in minutes. Droply personalizes first touches, spaces sends safely, and keeps every step moving forward.",
    bullets: ["Sequenced messaging", "Dynamic personalization", "Safe pacing controls"],
    visualTitle: "Campaign flow",
    visualRows: [
      ["Step 1", "Intro message"],
      ["Step 2", "Value follow-up"],
      ["Step 3", "Book meeting CTA"],
    ],
  },
  {
    eyebrow: "03",
    title: "AI Workflows",
    copy: "When a lead replies, visits your offer, or asks a question, Droply tags the conversation, drafts the response, and pushes the next action automatically.",
    bullets: ["Reply classification", "Next-step drafting", "Intent tagging"],
    visualTitle: "Live workflow triggers",
    visualRows: [
      ["Positive intent", "Assign closer"],
      ["Pricing question", "Send offer pack"],
      ["No response", "Re-engage in 48h"],
    ],
  },
  {
    eyebrow: "04",
    title: "Connect Your Tools",
    copy: "Droply fits into the stack you already use — sync campaign events into your CRM, calendar, spreadsheets, and internal reporting tools instantly.",
    bullets: ["CRM sync", "Webhook support", "Calendar handoff"],
    visualTitle: "Connected stack",
    visualRows: [
      ["HubSpot", "2-way sync"],
      ["Google Sheets", "Live export"],
      ["Calendar", "Meeting booked"],
    ],
  },
  {
    eyebrow: "05",
    title: "Optimized For Revenue",
    copy: "Track campaign performance beyond vanity metrics with reply quality, qualified intent, booked calls, and revenue impact — then scale the winners.",
    bullets: ["Reply quality", "Booked calls", "Pipeline visibility"],
    visualTitle: "Revenue dashboard",
    visualRows: [
      ["Meetings booked", "246"],
      ["Qualified replies", "913"],
      ["Pipeline created", "$84.2k"],
    ],
  },
]

const testimonials = [
  {
    quote:
      "We replaced fragmented outreach tools with Droply and doubled qualified replies within three weeks. Everything finally lives in one operating system.",
    name: "Aisha M.",
    role: "Growth Lead, BluePeak",
  },
  {
    quote:
      "Droply became the backbone of our Telegram outbound. The AI drafting plus inbox workflow cut handling time by more than half.",
    name: "Daniel R.",
    role: "Outbound Manager, Vertex Labs",
  },
  {
    quote:
      "Best Telegram-focused outbound platform we’ve used. Fast to launch, easy to track, and strong enough to scale across multiple offers.",
    name: "Marta P.",
    role: "Founder, Summit Growth",
  },
]

const benefits = [
  "Higher response rates through personalized, AI-assisted messaging",
  "Cleaner operations with one inbox across all sending accounts",
  "Visibility from first message to booked call and pipeline created",
  "Safer scale with pacing limits, rotation rules, and account guardrails",
]

const team = [
  {
    title: "Built by outbound operators",
    copy: "Every workflow is shaped by real campaign experience, not generic automation theory.",
  },
  {
    title: "AI + deliverability specialists",
    copy: "We obsess over reply quality, campaign health, and keeping your sending system stable.",
  },
  {
    title: "Hands-on support at scale",
    copy: "From first setup to multi-account growth, the team helps you launch quickly and scale safely.",
  },
]

const pricing = [
  {
    name: "Launch",
    price: "$100",
    sub: "per month",
    points: ["15 Telegram accounts included", "Up to 4,500 safe messages / month", "Core campaign management"],
  },
  {
    name: "Growth",
    price: "$150",
    sub: "per month",
    points: ["30 Telegram accounts included", "Up to 9,000 safe messages / month", "Advanced automations + analytics"],
    featured: true,
  },
  {
    name: "Scale",
    price: "$200",
    sub: "per month",
    points: ["45 Telegram accounts included", "Up to 13,500 safe messages / month", "Priority support + onboarding"],
  },
]

export default function Landing() {
  return (
    <PublicSiteShell>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(59,130,246,.14),transparent_28%),radial-gradient(circle_at_85%_10%,rgba(14,165,233,.12),transparent_22%)]" />
          <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 md:grid-cols-[1fr_.96fr] md:items-center md:py-20">
            <div className="max-w-2xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                Telegram sales engagement platform
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl md:text-6xl">
                Telegram outreach software that turns replies into revenue.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600 sm:text-xl">
                Droply helps agencies, founders, and sales teams automate Telegram outreach, source leads, manage conversations, and book more meetings with AI-powered workflows.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" className="gap-2 rounded-xl px-6">
                  <Link to="/signup">
                    Start For Free <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="rounded-xl px-6">
                  <Link to="/signin">See Demo</Link>
                </Button>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> No credit card
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Launch in minutes
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> AI-powered workflows
                </span>
              </div>
            </div>

            <div className="rounded-[28px] border border-[hsl(var(--border))] bg-white p-5 shadow-[0_35px_80px_-32px_rgba(15,23,42,.22)]">
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-4">
                <p className="text-sm font-medium text-slate-700">Ask Droply AI to</p>
                <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-sm">
                  <p className="text-sm leading-relaxed text-slate-900">
                    Create a Telegram outbound strategy for agency owners, write the first three messages, and set reply rules for pricing objections.
                  </p>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {heroPrompts.map((prompt) => (
                    <div
                      key={prompt}
                      className="rounded-2xl border border-[hsl(var(--border))] bg-slate-50 px-3 py-2 text-center text-xs font-medium text-slate-600"
                    >
                      {prompt}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <Rocket className="h-4 w-4 text-[hsl(var(--primary))]" /> Campaign snapshot
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {[
                      ["Messages sent", "12,482"],
                      ["Reply rate", "31.4%"],
                      ["Booked calls", "246"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between rounded-xl bg-white px-3 py-2.5 text-sm shadow-sm">
                        <span className="text-slate-600">{label}</span>
                        <span className="font-semibold text-slate-900">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[hsl(var(--border))] bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <Bot className="h-4 w-4 text-[hsl(var(--primary))]" /> AI reply queue
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {[
                      "Draft follow-up for warm lead",
                      "Tag pricing question as high intent",
                      "Hand off booked call to closer",
                    ].map((item) => (
                      <div key={item} className="rounded-xl bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-[hsl(var(--border))] bg-white/70">
          <div className="mx-auto w-full max-w-6xl px-6 py-10">
            <p className="mb-5 text-center text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
              Used by modern outbound teams
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-8">
              {logos.map((logo) => (
                <div
                  key={logo}
                  className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-3 text-center text-xs font-medium text-slate-600 shadow-sm"
                >
                  {logo}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-16 md:py-20">
          <div className="space-y-16 md:space-y-20">
            {productSections.map((section, index) => (
              <article key={section.title} className="grid gap-8 md:grid-cols-[1fr_.92fr] md:items-center">
                <div className={index % 2 === 1 ? "md:order-2" : ""}>
                  <p className="text-xs font-semibold tracking-[0.24em] text-[hsl(var(--primary))]">{section.eyebrow}</p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                    {section.title}
                  </h2>
                  <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">{section.copy}</p>
                  <div className="mt-5 flex flex-wrap gap-2.5">
                    {section.bullets.map((bullet) => (
                      <span
                        key={bullet}
                        className="rounded-full border border-[hsl(var(--border))] bg-white px-3 py-1.5 text-sm text-slate-600 shadow-sm"
                      >
                        {bullet}
                      </span>
                    ))}
                  </div>
                  <div className="mt-7">
                    <Button asChild className="rounded-xl px-5">
                      <Link to="/signup">Start For Free</Link>
                    </Button>
                  </div>
                </div>

                <div className={index % 2 === 1 ? "md:order-1" : ""}>
                  <div className="rounded-[28px] border border-[hsl(var(--border))] bg-white p-5 shadow-[0_30px_70px_-32px_rgba(15,23,42,.18)]">
                    <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-3">
                      <p className="text-sm font-medium text-slate-800">{section.visualTitle}</p>
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                        Live
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {section.visualRows.map(([label, value]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between rounded-2xl border border-[hsl(var(--border))] bg-slate-50 px-4 py-3"
                        >
                          <span className="text-sm text-slate-600">{label}</span>
                          <span className="text-sm font-semibold text-slate-900">{value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      {[MessagesSquare, Workflow, Calendar].map((Icon, itemIndex) => (
                        <div
                          key={`${section.title}-${itemIndex}`}
                          className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 text-center shadow-sm"
                        >
                          <Icon className="mx-auto h-5 w-5 text-[hsl(var(--primary))]" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-[hsl(var(--border))] bg-white/70">
          <div className="mx-auto w-full max-w-6xl px-6 py-16 md:py-20">
            <div className="text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Customer Testimonials</h2>
              <p className="mt-3 text-base text-slate-600 sm:text-lg">Real results. Real outbound teams.</p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {testimonials.map((testimonial) => (
                <article
                  key={testimonial.name}
                  className="rounded-[24px] border border-[hsl(var(--border))] bg-white p-6 shadow-[0_20px_45px_-35px_rgba(15,23,42,.28)]"
                >
                  <div className="flex gap-1 text-amber-500">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star key={index} className="h-4 w-4 fill-current" />
                    ))}
                  </div>
                  <p className="mt-4 text-sm leading-7 text-slate-700">“{testimonial.quote}”</p>
                  <p className="mt-5 text-sm font-semibold text-slate-900">{testimonial.name}</p>
                  <p className="text-xs text-slate-500">{testimonial.role}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="benefits" className="mx-auto w-full max-w-6xl px-6 py-16 md:py-20">
          <div className="rounded-[32px] border border-[hsl(var(--border))] bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(244,249,255,1)_100%)] p-8 shadow-[0_30px_70px_-36px_rgba(15,23,42,.22)] md:p-10">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Unlock The Power Of AI With Droply
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-slate-600">
                Centralize conversations, automate repetitive work, and turn Telegram outreach into a repeatable revenue engine.
              </p>
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-xl px-6">
                <Link to="/signup">Get Started</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-xl px-6">
                <a href="#pricing">See Pricing</a>
              </Button>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {benefits.map((benefit) => (
                <div key={benefit} className="flex items-start gap-3 rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-sm">
                  <Zap className="mt-0.5 h-4 w-4 text-[hsl(var(--primary))]" />
                  <p className="text-sm leading-6 text-slate-700">{benefit}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="team" className="border-y border-[hsl(var(--border))] bg-white/70">
          <div className="mx-auto w-full max-w-6xl px-6 py-16 md:py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Team Behind Droply</h2>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {team.map((item) => (
                <article key={item.title} className="rounded-[24px] border border-[hsl(var(--border))] bg-white p-6 shadow-sm">
                  <Users className="h-5 w-5 text-[hsl(var(--primary))]" />
                  <h3 className="mt-4 text-lg font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="mx-auto w-full max-w-6xl px-6 py-16 md:py-20">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Simple pricing</h2>
            <p className="mt-3 text-lg text-slate-600">
              Pricing starts at $100/month for 15 Telegram accounts, then increases by $50 for every additional 15 accounts.
              With a safe range of around 1-10 messages per account per day, that gives you up to roughly 450-4,500 messages per month on the entry package.
            </p>
            <p className="mt-3 max-w-2xl text-sm text-slate-500">
              Ideal for Telegram lead generation, outbound sales, and automated client acquisition workflows.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {pricing.map((plan) => (
              <article
                key={plan.name}
                className={`rounded-[28px] border p-6 shadow-sm ${
                  plan.featured
                    ? "border-[hsl(var(--primary))] bg-[linear-gradient(180deg,rgba(239,246,255,1)_0%,rgba(255,255,255,1)_100%)]"
                    : "border-[hsl(var(--border))] bg-white"
                }`}
              >
                <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
                <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">{plan.price}</p>
                <p className="text-sm text-slate-500">{plan.sub}</p>
                <ul className="mt-6 space-y-3">
                  {plan.points.map((point) => (
                    <li key={point} className="flex items-start gap-2 text-sm text-slate-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-6 w-full rounded-xl" variant={plan.featured ? "default" : "outline"}>
                  <Link to="/signup">Get Started</Link>
                </Button>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 pb-16 md:pb-20">
          <div className="rounded-[32px] border border-[hsl(var(--border))] bg-white p-8 shadow-[0_30px_80px_-38px_rgba(15,23,42,.24)] md:p-10">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="max-w-2xl">
                <h2 className="text-3xl font-semibold tracking-tight text-slate-900">Ready to scale Telegram outreach?</h2>
                <p className="mt-3 text-lg leading-relaxed text-slate-600">
                  Start your free Droply workspace and launch your first AI-assisted campaign in minutes.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 self-start rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700">
                <Shield className="h-4 w-4" /> Secure, measurable, and built for real outbound teams
              </div>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-xl px-6">
                <Link to="/signup">Create Your Workspace</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-xl px-6">
                <Link to="/signin">Sign In</Link>
              </Button>
            </div>
          </div>
        </section>
    </PublicSiteShell>
  )
}
