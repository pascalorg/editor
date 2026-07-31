'use client'

import { useSession } from './session-provider'

/** Header control: sign-in button when signed out, email + sign-out when in. */
export function AuthMenu() {
  const { user, loading, signOut } = useSession()

  if (loading) return null

  if (!user) {
    return (
      <a className="rounded-md border border-border px-3 py-1.5 font-medium text-sm" href="/signin">
        Sign in
      </a>
    )
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {user.role === 'admin' && (
        <>
          <a className="rounded-md border border-border px-3 py-1.5 font-medium" href="/console">
            Console
          </a>
          <a className="rounded-md border border-border px-3 py-1.5 font-medium" href="/admin">
            Scenes admin
          </a>
        </>
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
