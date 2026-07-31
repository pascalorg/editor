'use client'

import { useSession } from './session-provider'

/** Header control: sign-in button when signed out, email + sign-out when in. */
export function AuthMenu() {
  const { user, loading, openAuth, signOut } = useSession()

  if (loading) return null

  if (!user) {
    return (
      <button
        type="button"
        onClick={openAuth}
        className="rounded-md border border-border px-3 py-1.5 font-medium text-sm"
      >
        Sign in
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {user.role === 'admin' && (
        <a href="/admin" className="rounded-md border border-border px-3 py-1.5 font-medium">
          Admin
        </a>
      )}
      <span className="text-neutral-500">{user.email}</span>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-md border border-border px-3 py-1.5 font-medium"
      >
        Sign out
      </button>
    </div>
  )
}
