'use client'

import { Mail, X } from 'lucide-react'
import { useState } from 'react'
import { authClient } from '@/lib/auth/auth-client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './primitives/dialog'

interface SignInDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * SignInDialog - Magic link authentication dialog
 */
export function SignInDialog({ open, onOpenChange }: SignInDialogProps) {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      // Use better-auth's magic link sign in
      const result = await authClient.signIn.magicLink({
        email,
        callbackURL: window.location.origin,
      })

      if (result.error) {
        setError(result.error.message || 'Failed to send magic link')
      } else {
        setSuccess(true)
        setEmail('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange(false)
      // Reset state after a short delay to avoid flash
      setTimeout(() => {
        setEmail('')
        setError(null)
        setSuccess(false)
      }, 200)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Sign in to Pascal</DialogTitle>
          <button
            className="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 disabled:pointer-events-none"
            disabled={isLoading}
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </DialogHeader>

        {success ? (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
                <Mail className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">Check your email</h3>
                <p className="text-muted-foreground text-sm">
                  We've sent a magic link to <strong>{email}</strong>
                </p>
                <p className="text-muted-foreground text-sm">
                  Click the link in the email to sign in to your account.
                </p>
              </div>
            </div>
            <button
              className="w-full rounded-md border border-input px-4 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={handleClose}
            >
              Close
            </button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="font-medium text-sm" htmlFor="email">
                Email address
              </label>
              <input
                autoComplete="email"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoading}
                id="email"
                placeholder="you@example.com"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm">
                {error}
              </div>
            )}

            <button
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
              disabled={isLoading || !email}
              type="submit"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Sending magic link...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  Send magic link
                </>
              )}
            </button>

            <p className="text-center text-muted-foreground text-xs">
              We'll send you a magic link to sign in without a password.
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
