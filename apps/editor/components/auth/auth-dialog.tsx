'use client'

import { type FormEvent, useState } from 'react'

interface AuthDialogProps {
  onClose: () => void
  onSuccess: () => void
}

/**
 * A dependency-free modal (fixed overlay + centered card) using the same
 * Tailwind tokens as the rest of the editor, rather than pulling in a dialog
 * library. Sign in / register in one card.
 */
export function AuthDialog({ onClose, onSuccess }: AuthDialogProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) {
        onSuccess()
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(messageFor(body.error, res.status))
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex gap-4 text-sm">
          <button
            type="button"
            className={mode === 'login' ? 'font-semibold' : 'text-neutral-500'}
            onClick={() => setMode('login')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'font-semibold' : 'text-neutral-500'}
            onClick={() => setMode('register')}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          />
          <input
            type="password"
            required
            minLength={mode === 'register' ? 8 : undefined}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            placeholder={mode === 'register' ? 'Password (min 8 chars)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-foreground px-3 py-2 font-medium text-background text-sm disabled:opacity-60"
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}

function messageFor(error: string | undefined, status: number): string {
  switch (error) {
    case 'invalid_credentials':
      return 'Invalid email or password.'
    case 'email_taken':
      return 'That email is already registered.'
    case 'auth_unavailable':
      return 'Sign-in is not available on this deployment.'
    case 'rate_limited':
      return 'Too many attempts. Please wait a minute.'
    case 'invalid_request':
      return 'Please enter a valid email and a password of at least 8 characters.'
    default:
      return `Something went wrong (${status}).`
  }
}
