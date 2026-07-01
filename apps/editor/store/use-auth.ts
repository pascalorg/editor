'use client'

import type { User } from '@supabase/supabase-js'
import { create } from 'zustand'
import { getSupabaseClient } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase-types'

interface AuthState {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  /** Call once from a client boundary (e.g. ClientBootstrap). */
  init: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  isAdmin: () => boolean
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  loading: true,

  init: async () => {
    const sb = getSupabaseClient()

    // Restore existing session
    const { data: { session } } = await sb.auth.getSession()
    if (session?.user) {
      const profile = await fetchProfile(session.user.id)
      set({ user: session.user, profile, loading: false })
    } else {
      set({ loading: false })
    }

    // Listen for auth state changes
    sb.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const profile = await fetchProfile(session.user.id)
        set({ user: session.user, profile })
      } else {
        set({ user: null, profile: null })
      }
    })
  },

  signIn: async (email, password) => {
    const sb = getSupabaseClient()
    const { error } = await sb.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  },

  signOut: async () => {
    const sb = getSupabaseClient()
    await sb.auth.signOut()
    set({ user: null, profile: null })
  },

  isAdmin: () => get().profile?.role === 'admin',
}))

async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const sb = getSupabaseClient()
  const { data } = await sb
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return data ?? null
}
