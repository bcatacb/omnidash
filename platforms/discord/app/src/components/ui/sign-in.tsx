"use client"

import React, { useState } from "react"
import { Link } from "react-router-dom"

type PlanOption = {
  slug: string
  name: string
  price_monthly: number
  monthly_message_limit: number
  lead_limit: number
}

type LightLoginProps = {
  mode?: "signin" | "signup"
  name?: string
  email: string
  password: string
  loading?: boolean
  error?: string
  selectedPlan?: string
  plans?: PlanOption[]
  onNameChange?: (value: string) => void
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onPlanChange?: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}

const fallbackPlans: PlanOption[] = [
  { slug: "launch", name: "Launch", price_monthly: 100, monthly_message_limit: 4500, lead_limit: 10000 },
  { slug: "growth", name: "Growth", price_monthly: 150, monthly_message_limit: 9000, lead_limit: 20000 },
  { slug: "scale", name: "Scale", price_monthly: 200, monthly_message_limit: 13500, lead_limit: 30000 },
]

const BrandMark = () => (
  <div className="bg-white p-4 rounded-2xl shadow-lg mb-6">
    <svg width="48" height="48" viewBox="0 0 110 106" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M100.83 28.63L66.86 3.95c-7.25-5.26-17.07-5.26-24.35 0L8.54 28.63C1.29 33.89-1.76 43.23 1.01 51.77l12.98 39.93c2.77 8.53 10.72 14.3 19.7 14.3h41.97c8.98 0 16.93-5.76 19.7-14.3l12.98-39.93c2.77-8.53-.28-17.88-7.53-23.14ZM64.81 63.13l-10.13 18.55-10.13-18.55-18.55-10.13 18.55-10.13 10.13-18.55 10.13 18.55 18.55 10.13-18.55 10.13Z"
        fill="#3B82F6"
      />
    </svg>
  </div>
)

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-gray-700">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
)

const GithubIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-gray-700">
    <path
      d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.6.113.82-.26.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.386-1.332-1.755-1.332-1.755-1.087-.744.084-.729.084-.729 1.205.085 1.84 1.236 1.84 1.236 1.07 1.835 2.809 1.305 3.493.997.108-.776.42-1.305.763-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.627-5.373-12-12-12z"
      fill="#24292F"
    />
  </svg>
)

export const LightLogin = ({
  mode = "signin",
  name = "",
  email,
  password,
  loading = false,
  error,
  selectedPlan = "launch",
  plans,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onPlanChange,
  onSubmit,
}: LightLoginProps) => {
  const [showPassword, setShowPassword] = useState(false)
  const isSignup = mode === "signup"
  const planOptions = plans?.length ? plans : fallbackPlans

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 relative">
        <div className="absolute top-0 left-0 right-0 h-48 bg-gradient-to-b from-blue-100 via-blue-50 to-transparent opacity-40 blur-3xl -mt-20" />
        <div className="relative p-8">
          <div className="flex flex-col items-center mb-8">
            <BrandMark />
            <div className="p-0">
              <h2 className="text-2xl font-bold text-gray-900 text-center">{isSignup ? "Create Account" : "Welcome Back"}</h2>
              <p className="text-center text-gray-500 mt-2">
                {isSignup ? "Sign up to start your Telegram outreach workspace" : "Sign in to continue to your account"}
              </p>
            </div>
          </div>

          {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

          <div className="space-y-6 p-0">
            {isSignup && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Name</label>
                <input
                  value={name}
                  onChange={(event) => onNameChange?.(event.target.value)}
                  className="bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 h-12 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-500/50 focus:border-blue-500 w-full px-3 py-2 text-sm focus-visible:outline-none"
                  placeholder="Enter your name"
                  required
                />
              </div>
            )}

            {isSignup && (
              <div className="grid grid-cols-3 gap-2">
                {planOptions.map((plan) => (
                  <button
                    key={plan.slug}
                    type="button"
                    onClick={() => onPlanChange?.(plan.slug)}
                    className={`rounded-lg border p-3 text-left transition ${selectedPlan === plan.slug ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-gray-50 text-gray-700 hover:border-blue-200"}`}
                  >
                    <span className="block text-xs font-semibold">{plan.name}</span>
                    <span className="mt-1 block text-lg font-bold">${plan.price_monthly}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Email or Phone</label>
              <input
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                className="bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 h-12 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-500/50 focus:border-blue-500 w-full px-3 py-2 text-sm focus-visible:outline-none"
                placeholder="Enter your email or phone"
                type="email"
                required
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-gray-700">Password</label>
                {!isSignup && <a href="#" className="text-xs text-blue-600 hover:underline">Forgot password?</a>}
              </div>
              <div className="relative">
                <input
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  className="bg-gray-50 border border-gray-200 text-gray-900 pr-16 h-12 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-500/50 focus:border-blue-500 w-full px-3 py-2 text-sm focus-visible:outline-none"
                  placeholder="••••••••"
                  minLength={isSignup ? 8 : undefined}
                  required
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 hover:bg-gray-100 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors h-9 px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button disabled={loading} className="w-full h-12 bg-gradient-to-t from-blue-600 via-blue-500 to-blue-400 hover:from-blue-700 hover:via-blue-600 hover:to-blue-500 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow-md hover:shadow-blue-100 active:scale-[0.98] inline-flex items-center justify-center whitespace-nowrap text-sm disabled:pointer-events-none disabled:opacity-50">
              {loading ? (isSignup ? "Creating account..." : "Signing in...") : (isSignup ? "Sign Up" : "Sign In")}
            </button>

            <div className="flex items-center my-4">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="px-4 text-sm text-gray-400">or continue with</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button type="button" className="h-12 bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:text-blue-600 rounded-lg flex items-center justify-center gap-2 border whitespace-nowrap text-sm font-medium transition-colors">
                <GoogleIcon />
                <span className="whitespace-nowrap">Google</span>
              </button>

              <button type="button" className="h-12 bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:text-black rounded-lg flex items-center justify-center gap-2 border whitespace-nowrap text-sm font-medium transition-colors">
                <GithubIcon />
                <span className="whitespace-nowrap">GitHub</span>
              </button>
            </div>
          </div>

          <div className="p-0 mt-6">
            <p className="text-sm text-center text-gray-500 w-full">
              {isSignup ? "Already have an account? " : "Don't have an account? "}
              <Link to={isSignup ? "/signin" : "/signup"} className="text-blue-600 hover:underline font-medium">
                {isSignup ? "Sign in" : "Sign up"}
              </Link>
            </p>
          </div>
        </div>
      </form>
    </div>
  )
}
