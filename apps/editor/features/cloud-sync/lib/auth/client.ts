/**
 * Auth client for the editor using better-auth
 * Connects to the Pascal monorepo backend
 */

import { createAuthClient } from 'better-auth/react'
import {
  customSessionClient,
  magicLinkClient,
  organizationClient,
} from 'better-auth/client/plugins'

/**
 * Get the backend API URL
 * Default: http://localhost:3000 (monorepo backend)
 */
function getBackendURL(): string {
  // Check if we have an env variable for the backend URL
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL
  }

  // In browser, try to use the current origin if it's the same host
  if (typeof window !== 'undefined') {
    // For local development, always use localhost:3000 (monorepo backend)
    if (window.location.hostname === 'localhost') {
      return 'http://localhost:3000'
    }
    // For production, use the same origin
    return window.location.origin
  }

  // SSR fallback
  return 'http://localhost:3000'
}

/**
 * Auth client instance with better-auth
 * Configured to work with the Pascal monorepo backend
 */
export const authClient = createAuthClient({
  baseURL: getBackendURL(),
  plugins: [
    magicLinkClient(),
    organizationClient(),
    customSessionClient<{
      session: {
        activePropertyId: string | null
        activeOrganizationId: string | null
      }
    }>(),
  ],
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
