'use client'

import { useTranslation } from '@pascal-app/editor'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '../../lib/auth-client'

const MIN_PASSWORD_LENGTH = 8

export function ResetPasswordClientPage() {
  const t = useTranslation()
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token')
  const linkError = params.get('error')

  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // The callback redirects here with `?error=INVALID_TOKEN` when the link has
  // expired, so a missing token and a rejected one are the same dead end.
  if (!token || linkError) {
    return (
      <div className="space-y-4">
        <h1 className="font-semibold text-xl">{t('This reset link is no longer valid')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('Reset links expire after an hour. Request a new one and try again.')}
        </p>
        <button
          className="rounded-md bg-foreground px-4 py-2 text-background text-sm transition-colors hover:bg-foreground/90"
          onClick={() => router.push('/')}
          type="button"
        >
          {t('Back to the editor')}
        </button>
      </div>
    )
  }

  if (done) {
    return (
      <div className="space-y-4">
        <h1 className="font-semibold text-xl">{t('Your password has been changed')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('You can sign in with your new password now.')}
        </p>
        <button
          className="rounded-md bg-foreground px-4 py-2 text-background text-sm transition-colors hover:bg-foreground/90"
          onClick={() => router.push('/')}
          type="button"
        >
          {t('Back to the editor')}
        </button>
      </div>
    )
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('Your password must be at least 8 characters.'))
      return
    }
    if (password !== confirmation) {
      setError(t('The two passwords do not match.'))
      return
    }

    setIsSaving(true)
    try {
      const result = await authClient.resetPassword({ newPassword: password, token })
      if (result.error) {
        setError(result.error.message || t('The password could not be changed.'))
      } else {
        setDone(true)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('The password could not be changed.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <h1 className="font-semibold text-xl">{t('Choose a new password')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('Your password must be at least 8 characters.')}
        </p>
      </div>

      <div className="space-y-2">
        <label className="font-medium text-sm" htmlFor="new-password">
          {t('New password')}
        </label>
        <input
          autoComplete="new-password"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={isSaving}
          id="new-password"
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <label className="font-medium text-sm" htmlFor="confirm-password">
          {t('New password again')}
        </label>
        <input
          autoComplete="new-password"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={isSaving}
          id="confirm-password"
          required
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm">
          {error}
        </div>
      )}

      <button
        className="flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-background text-sm transition-colors hover:bg-foreground/90 disabled:opacity-50"
        disabled={isSaving || !password || !confirmation}
        type="submit"
      >
        {isSaving ? (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
        ) : (
          t('Save the new password')
        )}
      </button>
    </form>
  )
}
