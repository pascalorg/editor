'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  useTranslation,
} from '@pascal-app/editor'
import { Mail, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { authClient } from '../../lib/auth-client'

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

const LOGIN_METHOD_LABELS: Record<string, string> = {
  google: 'Google',
  'magic-link': 'Email link',
}

export interface SignInDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignInDialog({ open, onOpenChange }: SignInDialogProps) {
  const t = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoginView, setIsLoginView] = useState(true)
  const [usePassword, setUsePassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<'magic-link' | 'password-reset' | null>(null)

  // Better-auth might not export getLastUsedLoginMethod immediately in this version context,
  // we'll safely ignore it or use a simpler approach.
  const lastMethodLabel = null

  const handleGoogleSignIn = async () => {
    setError(null)
    setIsGoogleLoading(true)
    try {
      await authClient.signIn.social({
        provider: 'google',
        callbackURL: window.location.origin,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in with Google')
      setIsGoogleLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      if (usePassword) {
        if (isLoginView) {
          const result = await authClient.signIn.email({
            email,
            password,
            callbackURL: window.location.origin,
          })
          if (result.error) {
            setError(result.error.message || 'Failed to sign in')
          } else {
            onOpenChange(false)
          }
        } else {
          const result = await authClient.signUp.email({
            email,
            password,
            name: email.split('@')[0] || '',
            callbackURL: window.location.origin,
          })
          if (result.error) {
            setError(result.error.message || 'Failed to sign up')
          } else {
            onOpenChange(false)
          }
        }
      } else {
        const result = await authClient.signIn.magicLink({
          email,
          callbackURL: window.location.origin,
        })

        if (result.error) {
          setError(result.error.message || 'Failed to send magic link')
        } else {
          setSuccess('magic-link')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email address first')
      return
    }
    setError(null)
    setIsLoading(true)
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (result.error) {
        setError(result.error.message || 'Failed to send the reset link')
      } else {
        setSuccess('password-reset')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    if (!isLoading && !isGoogleLoading) {
      onOpenChange(false)
      setTimeout(() => {
        setEmail('')
        setPassword('')
        setError(null)
        setSuccess(null)
      }, 200)
    }
  }

  const anyLoading = isLoading || isGoogleLoading

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('Sign in to Pascal')}</DialogTitle>
          <button
            className="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 disabled:pointer-events-none"
            disabled={anyLoading}
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">{t('Close')}</span>
          </button>
        </DialogHeader>

        {success ? (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/20">
                <Mail className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">{t('Check your email')}</h3>
                <p className="text-muted-foreground text-sm">
                  {success === 'password-reset'
                    ? t("We've sent a password reset link to")
                    : t("We've sent a magic link to")}{' '}
                  <strong>{email}</strong>
                </p>
                <p className="text-muted-foreground text-sm">
                  {success === 'password-reset'
                    ? t('Open the link in the email to choose a new password.')
                    : t('Click the link in the email to sign in to your account.')}
                </p>
              </div>
            </div>
            <button
              className="w-full rounded-md border border-input px-4 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={handleClose}
            >
              {t('Close')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {lastMethodLabel && (
              <p className="text-center text-muted-foreground text-xs">
                {t('Last signed in with')} {lastMethodLabel}
              </p>
            )}

            {/* Google Sign-In */}
            <button
              className="flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              disabled={anyLoading}
              onClick={handleGoogleSignIn}
              type="button"
            >
              {isGoogleLoading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
              ) : (
                <GoogleIcon className="h-4 w-4" />
              )}
              {t('Continue with Google')}
            </button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">{t('or')}</span>
              </div>
            </div>

            {/* Form */}
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="font-medium text-sm text-foreground" htmlFor="email">
                  {t('Email address')}
                </label>
                <input
                  autoComplete="email"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={anyLoading}
                  id="email"
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {usePassword && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-medium text-sm text-foreground" htmlFor="password">
                      {t('Password')}
                    </label>
                    {isLoginView && (
                      <button
                        className="text-muted-foreground text-xs hover:text-foreground hover:underline disabled:opacity-50"
                        disabled={anyLoading}
                        onClick={handleForgotPassword}
                        type="button"
                      >
                        {t('Forgot your password?')}
                      </button>
                    )}
                  </div>
                  <input
                    autoComplete={isLoginView ? 'current-password' : 'new-password'}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={anyLoading}
                    id="password"
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              )}

              {error && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm">
                  {t(error)}
                </div>
              )}

              <button
                className="flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-background text-sm transition-colors hover:bg-foreground/90 disabled:opacity-50"
                disabled={anyLoading || !email || (usePassword && !password)}
                type="submit"
              >
                {isLoading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                ) : usePassword ? (
                  isLoginView ? (
                    t('Sign in')
                  ) : (
                    t('Sign up')
                  )
                ) : (
                  <>
                    <Mail className="h-4 w-4" />
                    {t('Send magic link')}
                  </>
                )}
              </button>

              <div className="flex items-center justify-center space-x-2 text-xs">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => setUsePassword(!usePassword)}
                >
                  {usePassword ? t('Use magic link instead') : t('Use password instead')}
                </button>
                {usePassword && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground hover:underline"
                      onClick={() => setIsLoginView(!isLoginView)}
                    >
                      {isLoginView ? t("Don't have an account?") : t('Already have an account?')}
                    </button>
                  </>
                )}
              </div>
            </form>

            <p className="text-center text-muted-foreground text-xs">
              {t('By signing in, you agree to our')}{' '}
              <Link href="/terms" className="underline hover:text-foreground">
                {t('Terms of Service')}
              </Link>{' '}
              {t('and')}{' '}
              <Link href="/privacy" className="underline hover:text-foreground">
                {t('Privacy Policy')}
              </Link>
              .
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
