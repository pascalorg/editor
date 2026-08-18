'use client'

import { useTranslation } from '@pascal-app/editor'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { authClient } from '../../lib/auth-client'

export function SettingsClientPage() {
  const t = useTranslation()
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()

  const [name, setName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  // Initialize name when session loads
  if (session?.user && !name && !isLoading && !message) {
    setName(session.user.name)
  }

  if (isPending) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-foreground border-t-transparent" />
      </div>
    )
  }

  if (!session?.user) {
    return (
      <div className="rounded-xl border border-border/60 border-dashed bg-background p-12 text-center">
        <h2 className="mb-2 font-semibold text-lg">{t('Not signed in')}</h2>
        <p className="text-muted-foreground text-sm">
          {t('Please sign in to access your account settings.')}
        </p>
        <div className="mt-4">
          <Link href="/" className="text-sm font-medium hover:underline">
            {t('Back to home')}
          </Link>
        </div>
      </div>
    )
  }

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setMessage(null)

    try {
      const result = await authClient.updateUser({
        name,
      })

      if (result.error) {
        setMessage({ type: 'error', text: result.error.message || 'Failed to update profile' })
      } else {
        setMessage({ type: 'success', text: 'Profile updated successfully' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'An error occurred' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setMessage(null)

    try {
      const result = await authClient.changePassword({
        newPassword,
        currentPassword,
        revokeOtherSessions: true,
      })

      if (result.error) {
        setMessage({ type: 'error', text: result.error.message || 'Failed to update password' })
      } else {
        setMessage({ type: 'success', text: 'Password updated successfully' })
        setCurrentPassword('')
        setNewPassword('')
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'An error occurred' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignOutAll = async () => {
    if (!confirm(t('Are you sure you want to sign out from all devices?'))) return

    setIsLoading(true)
    setMessage(null)

    try {
      const result = await authClient.revokeOtherSessions()
      if (result.error) {
        setMessage({ type: 'error', text: result.error.message || 'Failed to revoke sessions' })
      } else {
        setMessage({ type: 'success', text: 'All other sessions revoked' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'An error occurred' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="font-bold text-3xl tracking-tight">{t('Account Settings')}</h1>

      {message && (
        <div
          className={`rounded-md border p-4 text-sm ${
            message.type === 'error'
              ? 'border-destructive/50 bg-destructive/10 text-destructive'
              : 'border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400'
          }`}
        >
          {t(message.text)}
        </div>
      )}

      <div className="space-y-6 rounded-xl border border-border/60 bg-background p-6">
        <h2 className="font-semibold text-lg">{t('Profile')}</h2>
        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <div className="space-y-2">
            <label className="font-medium text-sm text-foreground" htmlFor="email">
              {t('Email address')}
            </label>
            <input
              className="w-full rounded-md border border-input bg-accent/50 px-3 py-2 text-sm text-muted-foreground focus-visible:outline-none"
              disabled
              id="email"
              type="email"
              value={session.user.email}
            />
            <p className="text-muted-foreground text-xs">{t('Email address cannot be changed.')}</p>
          </div>

          <div className="space-y-2">
            <label className="font-medium text-sm text-foreground" htmlFor="name">
              {t('Name')}
            </label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLoading}
              id="name"
              placeholder="Your name"
              required
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <button
            className="rounded-md bg-foreground px-4 py-2 font-medium text-background text-sm transition-colors hover:bg-foreground/90 disabled:opacity-50"
            disabled={isLoading || name === session.user.name}
            type="submit"
          >
            {t('Save Profile')}
          </button>
        </form>
      </div>

      <div className="space-y-6 rounded-xl border border-border/60 bg-background p-6">
        <h2 className="font-semibold text-lg">{t('Security')}</h2>
        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div className="space-y-2">
            <label className="font-medium text-sm text-foreground" htmlFor="current-password">
              {t('Current Password')}
            </label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLoading}
              id="current-password"
              required
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="font-medium text-sm text-foreground" htmlFor="new-password">
              {t('New Password')}
            </label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLoading}
              id="new-password"
              required
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <button
            className="rounded-md bg-foreground px-4 py-2 font-medium text-background text-sm transition-colors hover:bg-foreground/90 disabled:opacity-50"
            disabled={isLoading || !currentPassword || !newPassword}
            type="submit"
          >
            {t('Update Password')}
          </button>
        </form>

        <div className="pt-4 border-t border-border/60">
          <h3 className="mb-2 font-medium text-sm">{t('Sessions')}</h3>
          <p className="mb-4 text-muted-foreground text-sm">
            {t('Sign out of all other active sessions across your devices.')}
          </p>
          <button
            className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-2 font-medium text-destructive text-sm transition-colors hover:bg-destructive/20 disabled:opacity-50"
            disabled={isLoading}
            onClick={handleSignOutAll}
            type="button"
          >
            {t('Sign out all other devices')}
          </button>
        </div>
      </div>

      <TokenManager />

      <div className="space-y-6 rounded-xl border border-destructive/20 bg-destructive/5 p-6">
        <h2 className="font-semibold text-lg text-destructive">{t('Danger Zone')}</h2>
        
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border border-border/40 bg-background p-4">
            <div>
              <h3 className="font-medium text-sm">{t('Export Data')}</h3>
              <p className="text-muted-foreground text-xs mt-1">
                {t('Download a copy of your profile and all your scenes in JSON format.')}
              </p>
            </div>
            <button
              className="rounded-md border border-input bg-background px-4 py-2 font-medium text-foreground text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 whitespace-nowrap"
              disabled={isLoading}
              onClick={async () => {
                setIsLoading(true)
                try {
                  const response = await fetch('/api/account/export')
                  if (!response.ok) throw new Error('Export failed')
                  
                  const blob = await response.blob()
                  const url = window.URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `menart-3d-export-${session.user.id}.json`
                  document.body.appendChild(a)
                  a.click()
                  a.remove()
                  window.URL.revokeObjectURL(url)
                  setMessage({ type: 'success', text: 'Data exported successfully' })
                } catch (err) {
                  setMessage({ type: 'error', text: 'Failed to export data' })
                } finally {
                  setIsLoading(false)
                }
              }}
              type="button"
            >
              {t('Export Data')}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border border-destructive/40 bg-background p-4">
            <div>
              <h3 className="font-medium text-sm text-destructive">{t('Delete Account')}</h3>
              <p className="text-muted-foreground text-xs mt-1">
                {t('Permanently delete your account, scenes, and all associated data. This action cannot be undone after 30 days.')}
              </p>
            </div>
            <button
              className="rounded-md bg-destructive px-4 py-2 font-medium text-destructive-foreground text-sm transition-colors hover:bg-destructive/90 disabled:opacity-50 whitespace-nowrap"
              disabled={isLoading}
              onClick={async () => {
                const confirm1 = confirm(t('Are you sure you want to delete your account? This action cannot be undone after 30 days.'))
                if (!confirm1) return
                
                const confirm2 = prompt(t('Type "delete my account" to confirm.'))
                if (confirm2 !== 'delete my account') {
                  alert(t('Account deletion cancelled.'))
                  return
                }

                setIsLoading(true)
                try {
                  const response = await fetch('/api/account/delete', { method: 'POST' })
                  if (!response.ok) throw new Error('Deletion failed')
                  
                  await authClient.signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        router.push('/')
                        router.refresh()
                      },
                    },
                  })
                } catch (err) {
                  setMessage({ type: 'error', text: 'Failed to delete account' })
                  setIsLoading(false)
                }
              }}
              type="button"
            >
              {t('Delete Account')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TokenManager() {
  const t = useTranslation()
  const [tokens, setTokens] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [newTokenName, setNewTokenName] = useState('')
  const [createdToken, setCreatedToken] = useState<string | null>(null)

  // Use a ref to load only once on mount
  const hasLoaded = useRef(false)
  useEffect(() => {
    if (!hasLoaded.current) {
      hasLoaded.current = true
      loadTokens()
    }
  }, [])

  const loadTokens = async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/tokens')
      if (res.ok) {
        const data = await res.json()
        setTokens(data.tokens || [])
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTokenName) return
    setIsLoading(true)
    setCreatedToken(null)
    try {
      const res = await fetch('/api/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTokenName,
          scopes: ['scenes:read', 'scenes:write', 'scenes:delete'],
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setCreatedToken(data.token)
        setNewTokenName('')
        loadTokens()
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleRevoke = async (id: string) => {
    if (!confirm(t('Are you sure you want to revoke this token?'))) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/auth/tokens?id=${id}`, { method: 'DELETE' })
      if (res.ok) {
        loadTokens()
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6 rounded-xl border border-border/60 bg-background p-6">
      <h2 className="font-semibold text-lg">{t('Personal Access Tokens')}</h2>
      <p className="text-muted-foreground text-sm">
        {t('Tokens you have generated that can be used to access the Pascal API.')}
      </p>

      {createdToken && (
        <div className="rounded-md border border-green-500/50 bg-green-500/10 p-4">
          <p className="font-medium text-green-600 text-sm dark:text-green-400">
            {t('Token created successfully. Copy it now, you will not be able to see it again:')}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1 text-sm select-all">
              {createdToken}
            </code>
          </div>
        </div>
      )}

      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={t('Token name')}
          value={newTokenName}
          onChange={(e) => setNewTokenName(e.target.value)}
          required
        />
        <button
          className="rounded-md bg-foreground px-4 py-2 font-medium text-background text-sm transition-colors hover:bg-foreground/90 disabled:opacity-50 whitespace-nowrap"
          disabled={isLoading || !newTokenName}
          type="submit"
        >
          {t('Generate new token')}
        </button>
      </form>

      <div className="mt-4">
        {tokens.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4 text-center">
            {isLoading ? t('Loading...') : t('No tokens found.')}
          </p>
        ) : (
          <div className="space-y-3">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center justify-between rounded-lg border border-border/40 p-3"
              >
                <div>
                  <div className="font-medium text-sm">{token.name}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">pascal_pat_{token.tokenPrefix}••••</span>
                    <span className="mx-2">•</span>
                    {t('Created')} {new Date(token.createdAt).toLocaleDateString()}
                    <span className="mx-2">•</span>
                    {t('Scopes')}: {token.scopes?.join(', ')}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(token.id)}
                  disabled={isLoading}
                  className="rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  {t('Revoke')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-center">
        <button
          onClick={loadTokens}
          disabled={isLoading}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          {t('Refresh list')}
        </button>
      </div>
    </div>
  )
}
