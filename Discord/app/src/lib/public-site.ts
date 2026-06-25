export const publicNavLinks = [
  { label: "Benefits", href: "/#benefits" },
  { label: "Team", href: "/#team" },
  { label: "Pricing", href: "/pricing" },
] as const

export const publicFooterColumns = [
  {
    title: "Product",
    links: [
      { label: "Campaigns", href: "/campaigns", external: false },
      { label: "Unified Inbox", href: "/unibox", external: false },
      { label: "Analytics", href: "/analytics", external: false },
    ],
  },
  {
    title: "Explore",
    links: [
      { label: "Benefits", href: "/#benefits", external: false },
      { label: "Team", href: "/#team", external: false },
      { label: "Pricing", href: "/pricing", external: false },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Get Started", href: "/signup", external: false },
      { label: "Login", href: "/signin", external: false },
      { label: "Contact", href: "mailto:hello@droply.ai", external: true },
    ],
  },
] as const
