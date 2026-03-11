'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Pencil } from 'lucide-react'
import { useRef, useState } from 'react'
import { authClient } from '../lib/auth/client'
import { updateUsername, updateProfile, uploadAvatar, updateEmailNotifications } from '../lib/auth/actions'

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
  currentYoutubeUrl: string | null
  currentEmailNotifications: boolean
  connectedAccounts: { providerId: string; accountId: string }[]
}

export function SettingsPage({
  user,
  currentUsername,
  currentGithubUrl,
  currentXUrl,
  currentYoutubeUrl,
  currentEmailNotifications,
  connectedAccounts,
}: SettingsPageProps) {
  const [username, setUsername] = useState(currentUsername ?? '')
  const [githubUrl, setGithubUrl] = useState(currentGithubUrl ?? '')
  const [xUrl, setXUrl] = useState(currentXUrl ?? '')
  const [youtubeUrl, setYoutubeUrl] = useState(currentYoutubeUrl ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user.image)
  const [isSavingUsername, setIsSavingUsername] = useState(false)
  const [isSavingSocial, setIsSavingSocial] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [usernameMessage, setUsernameMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const [socialMessage, setSocialMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const [emailNotifications, setEmailNotifications] = useState(currentEmailNotifications)
  const [isSavingNotifications, setIsSavingNotifications] = useState(false)

  const isGoogleConnected = connectedAccounts.some((a) => a.providerId === 'google')
  const initials = currentUsername
    ? currentUsername.slice(0, 2).toUpperCase()
    : user.name
      ? user.name
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
      : user.email?.[0]?.toUpperCase() || 'U'

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploadingAvatar(true)
    const formData = new FormData()
    formData.append('avatar', file)

    const result = await uploadAvatar(formData)
    if (result.success && result.imageUrl) {
      setAvatarUrl(result.imageUrl)
    }
    setIsUploadingAvatar(false)
    // Reset input so the same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleConnectGoogle = async () => {
    setIsConnectingGoogle(true)
    try {
      await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/settings',
      })
    } catch {
      setIsConnectingGoogle(false)
    }
  }

  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault()
    setUsernameMessage(null)
    setIsSavingUsername(true)

    const result = await updateUsername(username)
    setUsernameMessage({
      type: result.success ? 'success' : 'error',
      text: result.success ? 'Username updated successfully' : (result.error ?? 'Failed'),
    })
    setIsSavingUsername(false)
  }

  const handleSaveSocial = async (e: React.FormEvent) => {
    e.preventDefault()
    setSocialMessage(null)
    setIsSavingSocial(true)

    const result = await updateProfile({
      githubUrl: githubUrl.trim() || null,
      xUrl: xUrl.trim() || null,
      youtubeUrl: youtubeUrl.trim() || null,
    })
    setSocialMessage({
      type: result.success ? 'success' : 'error',
      text: result.success
        ? 'Social links updated successfully'
        : (result.error ?? 'Failed'),
    })
    setIsSavingSocial(false)
  }

  const usernameChanged = username.trim() !== (currentUsername ?? '')
  const socialChanged =
    (githubUrl.trim() || '') !== (currentGithubUrl ?? '') ||
    (xUrl.trim() || '') !== (currentXUrl ?? '') ||
    (youtubeUrl.trim() || '') !== (currentYoutubeUrl ?? '')

  const handleToggleEmailNotifications = async () => {
    const newValue = !emailNotifications
    setEmailNotifications(newValue)
    setIsSavingNotifications(true)
    await updateEmailNotifications(newValue)
    setIsSavingNotifications(false)
  }

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
              {/* Avatar with upload */}
              <button
                type="button"
                onClick={handleAvatarClick}
                disabled={isUploadingAvatar}
                className="relative group shrink-0"
              >
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt={user.name || 'Profile'}
                    width={64}
                    height={64}
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted font-semibold text-lg">
                    {initials}
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Pencil className="h-4 w-4 text-white" />
                </div>
                {isUploadingAvatar && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  </div>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />
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

        {/* Connected Accounts Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Connected Accounts</h2>
          <div className="rounded-lg border border-border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <GoogleIcon className="h-5 w-5" />
                <div>
                  <div className="text-sm font-medium">Google</div>
                  {isGoogleConnected ? (
                    <div className="text-xs text-muted-foreground">
                      Connected
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Not connected
                    </div>
                  )}
                </div>
              </div>
              {isGoogleConnected ? (
                <span className="text-xs text-green-600 dark:text-green-400 font-medium px-2 py-1 rounded-full bg-green-50 dark:bg-green-900/20">
                  Connected
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectGoogle}
                  disabled={isConnectingGoogle}
                  className="rounded-md border border-input px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50"
                >
                  {isConnectingGoogle ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Notifications Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <div className="rounded-lg border border-border p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-sm font-medium">Email notifications</div>
                <p className="text-muted-foreground text-xs">
                  Receive emails about new features and updates.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={emailNotifications}
                onClick={handleToggleEmailNotifications}
                disabled={isSavingNotifications}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  emailNotifications ? 'bg-primary' : 'bg-input'
                }`}
              >
                <span
                  className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                    emailNotifications ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
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

              <div className="space-y-2">
                <label htmlFor="youtube" className="font-medium text-sm">
                  YouTube
                </label>
                <input
                  id="youtube"
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => {
                    setYoutubeUrl(e.target.value)
                    setSocialMessage(null)
                  }}
                  placeholder="https://youtube.com/@yourchannel"
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
