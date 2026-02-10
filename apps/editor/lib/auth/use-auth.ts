'use client'

import { authClient } from './auth-client'

/**
 * Hook to access authentication state using better-auth
 * @returns Current auth state including user, session, and loading status
 */
export function useAuth() {
  const session = authClient.useSession()

  return {
    user: session.data?.user ?? null,
    session: session.data?.session ?? null,
    isAuthenticated: !!session.data?.user && !!session.data?.session,
    isLoading: session.isPending,
    signOut: () => authClient.signOut(),
    signIn: authClient.signIn,
  }
}
