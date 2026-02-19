'use client'

import { useCallback, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { updateUsername, checkUsernameAvailability } from '../lib/auth/actions'

interface UsernameOnboardingDialogProps {
  open: boolean
  onComplete: () => void
}

export function UsernameOnboardingDialog({ open, onComplete }: UsernameOnboardingDialogProps) {
  const [username, setUsername] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'available' | 'taken'>(
    'idle',
  )

  const validate = (value: string): string | null => {
    if (value.length < 3) return 'Must be at least 3 characters'
    if (value.length > 30) return 'Must be at most 30 characters'
    if (!/^[a-zA-Z0-9_-]+$/.test(value))
      return 'Only letters, numbers, hyphens, and underscores'
    return null
  }

  const checkAvailability = useCallback(async (value: string) => {
    const validationError = validate(value)
    if (validationError) {
      setAvailability('idle')
      return
    }
    setAvailability('checking')
    const result = await checkUsernameAvailability(value)
    setAvailability(result.available ? 'available' : 'taken')
  }, [])

  useEffect(() => {
    if (!username.trim()) {
      setAvailability('idle')
      return
    }
    const timer = setTimeout(() => checkAvailability(username.trim()), 300)
    return () => clearTimeout(timer)
  }, [username, checkAvailability])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = username.trim()
    const validationError = validate(trimmed)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setIsSaving(true)

    const result = await updateUsername(trimmed)
    if (result.success) {
      onComplete()
    } else {
      setError(result.error ?? 'Failed to set username')
    }
    setIsSaving(false)
  }

  const validationError = username.trim() ? validate(username.trim()) : null
  const canSubmit = !isSaving && !validationError && availability === 'available'

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[420px] [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>Choose your username</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">
          Pick a public username for the community hub. This will be visible on projects you share.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                @
              </span>
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value)
                  setError(null)
                }}
                placeholder="your-username"
                className="w-full rounded-md border border-input bg-background pl-7 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isSaving}
                autoFocus
                minLength={3}
                maxLength={30}
              />
            </div>

            {/* Status indicators */}
            {username.trim() && !validationError && (
              <div className="text-xs">
                {availability === 'checking' && (
                  <span className="text-muted-foreground">Checking availability...</span>
                )}
                {availability === 'available' && (
                  <span className="text-green-600 dark:text-green-400">Username is available</span>
                )}
                {availability === 'taken' && (
                  <span className="text-destructive">Username is already taken</span>
                )}
              </div>
            )}
            {validationError && (
              <p className="text-destructive text-xs">{validationError}</p>
            )}
            {!username.trim() && (
              <p className="text-muted-foreground text-xs">
                3-30 characters. Letters, numbers, hyphens, and underscores only.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? 'Setting username...' : 'Continue'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
