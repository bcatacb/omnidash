import { useEffect, useState } from "react"
import { Navigate, useLocation } from "react-router-dom"

type Props = {
  children: JSX.Element
}

export default function RequireAuth({ children }: Props) {
  const location = useLocation()
  const [status, setStatus] = useState<"loading" | "ok" | "unauthorized">("loading")

  useEffect(() => {
    let cancelled = false

    const validate = async () => {
      try {
        const res = await fetch("/api/auth/me")
        if (!res.ok) {
          if (!cancelled) {
            localStorage.removeItem("tg_saas_session")
            localStorage.removeItem("tg_saas_user")
            setStatus("unauthorized")
          }
          return
        }

        const user = await res.json()
        if (!cancelled) {
          localStorage.setItem("tg_saas_user", JSON.stringify(user))
          setStatus("ok")
        }
      } catch {
        if (!cancelled) setStatus("unauthorized")
      }
    }

    validate()
    return () => {
      cancelled = true
    }
  }, [])

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7] text-[#6B7280] text-sm">
        Checking session...
      </div>
    )
  }

  if (status === "unauthorized") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}

