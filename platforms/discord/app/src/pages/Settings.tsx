import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useTheme } from "@/components/theme/ThemeProvider"
import { getAccountSlotsLeft } from "@/lib/pricing-utils"

interface ApiKeyItem {
  id: string
  name: string
  token_prefix: string
  created_at: string
  last_used_at?: string | null
}

type SubscriptionSummary = {
  name: string
  slug: string
  price_monthly: number
  account_slot_limit: number | null
  monthly_safe_messages_min: number | null
  monthly_safe_messages_max: number | null
  is_custom?: boolean
}

type AuthUser = {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  subscription?: SubscriptionSummary | null
  preferences?: {
    plan_recommendations_enabled?: boolean
  }
}

export default function Settings() {
  const { preference, effectiveTheme, setPreference } = useTheme()
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [originalFullName, setOriginalFullName] = useState("")
  const [originalEmail, setOriginalEmail] = useState("")
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMessage, setProfileMessage] = useState("")
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [accountsCount, setAccountsCount] = useState(0)

  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [newApiKeyName, setNewApiKeyName] = useState("")
  const [createdToken, setCreatedToken] = useState("")
  const [loadingApiKeys, setLoadingApiKeys] = useState(false)
  const [creatingApiKey, setCreatingApiKey] = useState(false)

  const [planRecommendationsEnabled, setPlanRecommendationsEnabled] = useState(true)
  const [savingPreferences, setSavingPreferences] = useState(false)
  const [preferencesMessage, setPreferencesMessage] = useState("")

  const fetchProfile = async () => {
    try {
      const res = await fetch("/api/auth/me")
      if (!res.ok) return
      const user = await res.json()
      setAuthUser(user)
      const assembledName = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim()
      const resolvedName = assembledName || ""
      const resolvedEmail = String(user?.email || "")
      setFullName(resolvedName)
      setEmail(resolvedEmail)
      setOriginalFullName(resolvedName)
      setOriginalEmail(resolvedEmail)
      setPlanRecommendationsEnabled(user?.preferences?.plan_recommendations_enabled !== false)
    } catch (error) {
      console.error("Failed to fetch profile", error)
    }
  }

  const fetchAccounts = async () => {
    // TODO(discord): replace with discord bridge call - fetch connected discord accounts
    try {
      const res = await fetch("/api/accounts")
      if (!res.ok) return
      const rows = await res.json()
      setAccountsCount(Array.isArray(rows) ? rows.length : 0)
    } catch (error) {
      console.error("Failed to fetch accounts", error)
    }
  }

  const fetchApiKeys = async () => {
    setLoadingApiKeys(true)
    try {
      const res = await fetch("/api/settings/api-keys")
      if (!res.ok) return
      const data = await res.json()
      setApiKeys(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error("Failed to fetch API keys", error)
    } finally {
      setLoadingApiKeys(false)
    }
  }

  useEffect(() => {
    fetchProfile()
    fetchAccounts()
    fetchApiKeys()
  }, [])

  const hasProfileChanges =
    fullName.trim() !== originalFullName.trim() ||
    email.trim().toLowerCase() !== originalEmail.trim().toLowerCase()

  const accountSlotsLeft = useMemo(
    () => getAccountSlotsLeft(authUser?.subscription?.account_slot_limit ?? null, accountsCount),
    [authUser?.subscription?.account_slot_limit, accountsCount]
  )

  const saveProfile = async () => {
    if (!hasProfileChanges || savingProfile) return
    setSavingProfile(true)
    setProfileMessage("")

    try {
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setProfileMessage(String(data?.error || "Failed to save profile"))
        return
      }

      setAuthUser(data)
      const nextName = [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim()
      const nextEmail = String(data?.email || email).trim()
      setFullName(nextName)
      setEmail(nextEmail)
      setOriginalFullName(nextName)
      setOriginalEmail(nextEmail)
      setProfileMessage("Profile saved successfully")
    } catch (error) {
      console.error("Failed to save profile", error)
      setProfileMessage("Failed to save profile")
    } finally {
      setSavingProfile(false)
    }
  }

  const savePreferences = async (nextValue: boolean) => {
    setPlanRecommendationsEnabled(nextValue)
    setPreferencesMessage("")
    setSavingPreferences(true)

    try {
      const res = await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_recommendations_enabled: nextValue }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(String(data?.error || "Failed to save preferences"))
      }
      setPreferencesMessage("Recommendation preference updated")
      setAuthUser((current) => current ? {
        ...current,
        preferences: {
          ...current.preferences,
          plan_recommendations_enabled: data?.plan_recommendations_enabled !== false,
        },
      } : current)
    } catch (error) {
      console.error("Failed to save preferences", error)
      setPreferencesMessage(error instanceof Error ? error.message : "Failed to save preferences")
      setPlanRecommendationsEnabled((current) => !current)
    } finally {
      setSavingPreferences(false)
    }
  }

  const createApiKey = async () => {
    setCreatingApiKey(true)
    setCreatedToken("")
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newApiKeyName }),
      })
      if (!res.ok) return
      const data = await res.json()
      setCreatedToken(String(data?.token || ""))
      setNewApiKeyName("")
      await fetchApiKeys()
    } catch (error) {
      console.error("Failed to create API key", error)
    } finally {
      setCreatingApiKey(false)
    }
  }

  const revokeApiKey = async (id: string) => {
    try {
      const res = await fetch(`/api/settings/api-keys/${id}`, { method: "DELETE" })
      if (!res.ok) return
      await fetchApiKeys()
    } catch (error) {
      console.error("Failed to revoke API key", error)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your profile, plan visibility, account slots, and integrations.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card text-card-foreground shadow-sm">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-[15px] font-semibold text-card-foreground">Current Plan</CardTitle>
            <CardDescription className="text-[13px] text-muted-foreground">See the package currently active on your workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div className="text-2xl font-black text-card-foreground">{authUser?.subscription?.name || "No plan"}</div>
            <p className="text-sm text-muted-foreground">
              {authUser?.subscription?.is_custom
                ? "Custom workspace with flexible limits."
                : authUser?.subscription
                  ? `$${authUser.subscription.price_monthly}/month`
                  : "Assign a plan to unlock slot visibility and pricing context."}
            </p>
            <div className="rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
              <div className="font-black text-foreground">Account slots</div>
              <div className="mt-1">
                {authUser?.subscription?.account_slot_limit == null
                  ? `${accountsCount} used • unlimited available`
                  : `${accountsCount} used • ${accountSlotsLeft ?? 0} left out of ${authUser.subscription.account_slot_limit}`}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-accent/40 p-4 text-sm text-muted-foreground">
              <div className="font-black text-foreground">Safe monthly message window</div>
              <div className="mt-1">
                {authUser?.subscription?.monthly_safe_messages_min == null
                  ? "Custom / unlimited"
                  : `${authUser.subscription.monthly_safe_messages_min.toLocaleString()}-${authUser.subscription.monthly_safe_messages_max?.toLocaleString()} messages / month`}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card text-card-foreground shadow-sm">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-[15px] font-semibold text-card-foreground">Workspace Preferences</CardTitle>
            <CardDescription className="text-[13px] text-muted-foreground">Control optional UI features for this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="rounded-2xl border border-border bg-background p-4">
              <div className="text-sm font-semibold text-foreground">Theme</div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Choose how the workspace UI should render. Current mode: {effectiveTheme}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["light", "dark", "system"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={preference === value ? "default" : "outline"}
                    className="capitalize"
                    onClick={() => setPreference(value)}
                  >
                    {value}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-background p-4">
              <div>
                <div className="text-[13px] font-semibold text-foreground">Smart plan recommendations</div>
                <p className="mt-1 text-[12px] leading-6 text-muted-foreground">
                  Show the pricing volume calculator and recommended package hints on the landing page when you&apos;re signed in.
                </p>
              </div>
              <Switch checked={planRecommendationsEnabled} onCheckedChange={savePreferences} disabled={savingPreferences} />
            </div>
            {preferencesMessage && (
              <p className={`text-[12px] ${preferencesMessage.toLowerCase().includes("failed") ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                {preferencesMessage}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4">
        <Card className="border-border bg-card text-card-foreground shadow-sm">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-[15px] font-semibold text-card-foreground">Profile Details</CardTitle>
            <CardDescription className="text-[13px] text-muted-foreground">Update your personal information and email.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-2">
              <label className="text-[13px] font-medium text-foreground">Full Name</label>
              <Input
                value={fullName}
                onChange={(event) => {
                  setFullName(event.target.value)
                  if (profileMessage) setProfileMessage("")
                }}
                className="max-w-md border-border bg-background text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-[13px] font-medium text-foreground">Email Address</label>
              <Input
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  if (profileMessage) setProfileMessage("")
                }}
                type="email"
                className="max-w-md border-border bg-background text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                className="bg-[#0062FF] hover:bg-[#0052D6] text-white"
                onClick={saveProfile}
                disabled={savingProfile || !hasProfileChanges}
              >
                {savingProfile ? "Saving..." : "Save Changes"}
              </Button>
              {profileMessage && (
                <p className={`text-[12px] ${profileMessage.toLowerCase().includes("success") ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                  {profileMessage}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card text-card-foreground shadow-sm">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-[15px] font-semibold text-card-foreground">API Access</CardTitle>
            <CardDescription className="text-[13px] text-muted-foreground">
              Create personal API keys for integrations. Keys are shown only once.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={newApiKeyName}
                onChange={(event) => setNewApiKeyName(event.target.value)}
                placeholder="API key name (optional)"
                className="max-w-md border-border bg-background text-foreground placeholder:text-muted-foreground"
              />
              <Button
                type="button"
                className="bg-[#0062FF] hover:bg-[#0052D6] text-white"
                onClick={createApiKey}
                disabled={creatingApiKey}
              >
                {creatingApiKey ? "Creating..." : "Create API Key"}
              </Button>
              <a
                href="/api/docs"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                API Documentation
              </a>
            </div>

            {createdToken && (
              <div className="rounded-md border border-border bg-accent/40 p-3">
                <p className="mb-1 text-[12px] font-semibold text-primary">Copy this API key now</p>
                <p className="break-all text-[12px] text-foreground">{createdToken}</p>
                <div className="mt-2">
                  <Button type="button" variant="outline" className="border-gray-200" onClick={() => navigator.clipboard.writeText(createdToken)}>
                    Copy Key
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {loadingApiKeys && <p className="text-[12px] text-muted-foreground">Loading API keys...</p>}
              {!loadingApiKeys && apiKeys.length === 0 && (
                <p className="text-[12px] text-muted-foreground">No API keys created yet.</p>
              )}
              {apiKeys.map((key) => (
                <div key={key.id} className="flex flex-col justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{key.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {key.token_prefix} • Created {new Date(key.created_at).toLocaleString()}
                      {key.last_used_at ? ` • Last used ${new Date(key.last_used_at).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
                    onClick={() => revokeApiKey(key.id)}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-500/30 bg-red-500/10 text-card-foreground shadow-sm">
          <CardHeader className="border-b border-red-500/20">
            <CardTitle className="text-[15px] font-semibold text-red-700 dark:text-red-300">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h4 className="text-[13px] font-medium text-foreground">Delete Workspace</h4>
                <p className="mt-1 text-[11px] text-muted-foreground">Permanently remove your data and connected accounts.</p>
              </div>
              <Button variant="destructive" className="bg-red-600 hover:bg-red-700">Delete Workspace</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
