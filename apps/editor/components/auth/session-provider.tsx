'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'

export interface SessionUser {
  id: string
  email: string
  role: 'admin' | 'editor' | 'viewer'
}

interface SessionValue {
  user: SessionUser | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  /** Sends the visitor to the console's sign-in; used by gated actions on 401. */
  openAuth: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

/** The console's /api/auth/session response, reduced to what the editor uses. */
interface ConsoleSessionResponse {
  state: 'anonymous' | 'signedIn' | 'mfaRequired' | 'firstSignIn'
  user: { id: string; email: string; permissions?: string[] } | null
}

/**
 * Sign-in itself now lives in the console (/signin): it owns passwords, 2FA
 * and lockout, so the editor no longer renders its own dialog — gated actions
 * navigate to the console and come back signed in. Only a fully signed-in
 * session counts; a half-open one (2FA pending, forced password change) is
 * treated as signed out.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' })
      const body = (await res.json()) as ConsoleSessionResponse
      if (body.state === 'signedIn' && body.user) {
        const permissions = body.user.permissions ?? []
        setUser({
          id: body.user.id,
          email: body.user.email,
          // Mirrors the server-side fold in lib/auth/session.ts.
          role: permissions.includes('admin_access')
            ? 'admin'
            : permissions.includes('edit_projects') || permissions.includes('create_projects')
              ? 'editor'
              : 'viewer',
        })
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/signout', { method: 'POST' }).catch(() => {})
    setUser(null)
  }, [])

  const openAuth = useCallback(() => {
    window.location.href = '/signin'
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <SessionContext.Provider value={{ user, loading, refresh, signOut, openAuth }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    // Rendered outside the provider (shouldn't happen); degrade to signed-out.
    return {
      user: null,
      loading: false,
      refresh: async () => {},
      signOut: async () => {},
      openAuth: () => {},
    }
  }
  return ctx
}
