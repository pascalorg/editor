'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { AuthDialog } from './auth-dialog'

export interface SessionUser {
  id: string
  email: string
  role: 'user' | 'admin'
}

interface SessionValue {
  user: SessionUser | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  /** Opens the sign-in dialog; used by gated actions when signed out or on 401. */
  openAuth: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' })
      const body = (await res.json()) as { user: SessionUser | null }
      setUser(body.user ?? null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
  }, [])

  const openAuth = useCallback(() => setDialogOpen(true), [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <SessionContext.Provider value={{ user, loading, refresh, signOut, openAuth }}>
      {children}
      {dialogOpen && (
        <AuthDialog
          onClose={() => setDialogOpen(false)}
          onSuccess={() => {
            setDialogOpen(false)
            void refresh()
          }}
        />
      )}
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
