import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { LightLogin } from "@/components/ui/sign-in"

type Plan = {
  slug: string
  name: string
  price_monthly: number
  monthly_message_limit: number
  lead_limit: number
  description?: string
}

export default function SignUp() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [plans, setPlans] = useState<Plan[]>([])
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [plan, setPlan] = useState(params.get('plan') || 'launch')
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const loadPlans = async () => {
      try {
        const res = await fetch('/api/auth/plans')
        if (!res.ok) return
        const data = await res.json()
        setPlans((data || []).filter((item: Plan) => item.slug !== 'enterprise'))
      } catch (e) {
        console.error("Failed to load plans", e)
      }
    }
    loadPlans()
  }, [])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, email, password, plan }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Sign up failed')
      localStorage.setItem('tg_saas_session', data.token)
      localStorage.setItem('tg_saas_user', JSON.stringify(data.user))
      navigate('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <LightLogin
      mode="signup"
      name={name}
      email={email}
      password={password}
      loading={loading}
      error={error}
      selectedPlan={plan}
      plans={plans}
      onNameChange={setName}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onPlanChange={setPlan}
      onSubmit={submit}
    />
  )
}
