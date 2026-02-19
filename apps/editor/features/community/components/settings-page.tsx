'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { updateUsername, updateProfile } from '../lib/auth/actions'

interface SettingsPageProps {
  user: {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
  currentUsername: string | null
  currentGithubUrl: string | null
  currentXUrl: string | null
}

export function SettingsPage({
  user,
  currentUsername,
  currentGithubUrl,
  currentXUrl,
}: SettingsPageProps) {
  const [username, setUsername] = useState(currentUsername ?? '')
  const [githubUrl, setGithubUrl] = useState(currentGithubUrl ?? '')
  const [xUrl, setXUrl] = useState(currentXUrl ?? '')
  const [isSavingUsername, setIsSavingUsername] = useState(false)
  const [isSavingSocial, setIsSavingSocial] = useState(false)
  const [usernameMessage, setUsernameMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const [socialMessage, setSocialMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault()
    setUsernameMessage(null)
    setIsSavingUsername(true)

    const result = await updateUsername(username)

    if (result.success) {
      setUsernameMessage({ type: 'success', text: 'Username updated successfully' })
    } else {
      setUsernameMessage({ type: 'error', text: result.error ?? 'Failed to update username' })
    }

    setIsSavingUsername(false)
  }

  const handleSaveSocial = async (e: React.FormEvent) => {
    e.preventDefault()
    setSocialMessage(null)
    setIsSavingSocial(true)

    const result = await updateProfile({
      githubUrl: githubUrl.trim() || null,
      xUrl: xUrl.trim() || null,
    })

    if (result.success) {
      setSocialMessage({ type: 'success', text: 'Social links updated successfully' })
    } else {
      setSocialMessage({ type: 'error', text: result.error ?? 'Failed to update social links' })
    }

    setIsSavingSocial(false)
  }

  const usernameChanged = username.trim() !== (currentUsername ?? '')
  const socialChanged =
    (githubUrl.trim() || '') !== (currentGithubUrl ?? '') ||
    (xUrl.trim() || '') !== (currentXUrl ?? '')

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Back</span>
            </Link>
            <h1 className="text-xl font-bold">Settings</h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-2xl px-6 py-8 space-y-8">
        {/* Profile Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Profile</h2>
          <div className="rounded-lg border border-border p-6 space-y-6">
            <div className="flex items-center gap-4">
              {user.image ? (
                <Image
                  src={user.image}
                  alt={user.name || 'Profile'}
                  width={64}
                  height={64}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted font-semibold text-lg">
                  {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || 'U'}
                </div>
              )}
              <div>
                {user.name && <div className="font-medium">{user.name}</div>}
                {user.email && (
                  <div className="text-muted-foreground text-sm">{user.email}</div>
                )}
              </div>
            </div>

            <form onSubmit={handleSaveUsername} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="username" className="font-medium text-sm">
                  Public Username
                </label>
                <p className="text-muted-foreground text-xs">
                  Your public display name on the community hub.
                </p>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    setUsernameMessage(null)
                  }}
                  placeholder="your-username"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSavingUsername}
                  minLength={3}
                  maxLength={30}
                  pattern="[a-zA-Z0-9_-]+"
                />
                <p className="text-muted-foreground text-xs">
                  3-30 characters. Letters, numbers, hyphens, and underscores only.
                </p>
              </div>

              {usernameMessage && (
                <div
                  className={`rounded-md border p-3 text-sm ${
                    usernameMessage.type === 'success'
                      ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
                      : 'border-destructive/50 bg-destructive/10 text-destructive'
                  }`}
                >
                  {usernameMessage.text}
                </div>
              )}

              <button
                type="submit"
                disabled={isSavingUsername || !usernameChanged || !username.trim()}
                className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isSavingUsername ? 'Saving...' : 'Save Username'}
              </button>
            </form>
          </div>
        </section>

        {/* Social Links Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Social Links</h2>
          <div className="rounded-lg border border-border p-6">
            <form onSubmit={handleSaveSocial} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="github" className="font-medium text-sm">
                  GitHub
                </label>
                <input
                  id="github"
                  type="url"
                  value={githubUrl}
                  onChange={(e) => {
                    setGithubUrl(e.target.value)
                    setSocialMessage(null)
                  }}
                  placeholder="https://github.com/yourusername"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSavingSocial}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="x" className="font-medium text-sm">
                  X (Twitter)
                </label>
                <input
                  id="x"
                  type="url"
                  value={xUrl}
                  onChange={(e) => {
                    setXUrl(e.target.value)
                    setSocialMessage(null)
                  }}
                  placeholder="https://x.com/yourusername"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSavingSocial}
                />
              </div>

              {socialMessage && (
                <div
                  className={`rounded-md border p-3 text-sm ${
                    socialMessage.type === 'success'
                      ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
                      : 'border-destructive/50 bg-destructive/10 text-destructive'
                  }`}
                >
                  {socialMessage.text}
                </div>
              )}

              <button
                type="submit"
                disabled={isSavingSocial || !socialChanged}
                className="rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isSavingSocial ? 'Saving...' : 'Save Social Links'}
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  )
}
