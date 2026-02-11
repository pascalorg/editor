import { magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/**
 * Get the auth base URL
 * In development: use the editor URL (localhost:3000)
 * In production: use the same origin
 */
function getAuthURL(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  // SSR fallback
  return process.env.BETTER_AUTH_URL || 'http://localhost:3000'
}

/**
 * Auth client instance
 * Configured for magic link authentication
 */
export const authClient = createAuthClient({
  baseURL: getAuthURL(),
  plugins: [magicLinkClient()],
})

/**
 * Export types for use in components
 */
export type AuthState = {
  user: (typeof authClient)['$Infer']['Session']['user'] | null
  session: (typeof authClient)['$Infer']['Session']['session'] | null
  isLoading: boolean
}

export type User = NonNullable<AuthState['user']>
export type Session = NonNullable<AuthState['session']>
