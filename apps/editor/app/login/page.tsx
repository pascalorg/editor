'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { useAuth } from '@/store/use-auth'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const signIn = useAuth((s) => s.signIn)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const next = params.get('next') ?? '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await signIn(email, password)
    if (error) {
      setError(error)
      setLoading(false)
    } else {
      router.replace(next)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-background p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="font-bold text-2xl text-foreground">Sign in</h1>
          <p className="mt-1 text-muted-foreground text-sm">Enter your credentials to continue</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground text-xs" htmlFor="email">
              Email
            </label>
            <input
              autoComplete="email"
              className="rounded-lg border border-border/60 bg-accent/30 px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none focus:ring-1 focus:ring-foreground/20"
              id="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground text-xs" htmlFor="password">
              Password
            </label>
            <input
              autoComplete="current-password"
              className="rounded-lg border border-border/60 bg-accent/30 px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none focus:ring-1 focus:ring-foreground/20"
              id="password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              type="password"
              value={password}
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400 text-xs">
              {error}
            </p>
          )}

          <button
            className="mt-2 rounded-lg bg-foreground px-4 py-2.5 font-semibold text-background text-sm transition-opacity hover:opacity-80 disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
