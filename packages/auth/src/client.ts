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

  // SSR fallback - detect environment from Vercel variables
  const isDevelopment =
    process.env.NODE_ENV === 'development' ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'development'
  const isPreview = process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview'
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'

  if (isDevelopment) {
    return process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`
  }

  if (isPreview && process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
  }

  if (isProduction) {
    return (
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://editor.pascal.app')
    )
  }

  return 'http://localhost:3000'
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
