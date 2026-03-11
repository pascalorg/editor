'use client'

import { Home } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuth } from '../lib/auth/hooks'
import { useProjectStore } from '../lib/projects/store'
import { ProfileDropdown } from './profile-dropdown'

/**
 * CloudSaveButton - Shows authentication state and project management
 *
 * Guest: Shows "Home" button
 * Authenticated: Shows ProfileDropdown
 */
export function CloudSaveButton() {
  const { isAuthenticated, isLoading } = useAuth()
  const initialize = useProjectStore(state => state.initialize)
  const router = useRouter()

  // Initialize project store when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      initialize()
    }
  }, [isAuthenticated, initialize])

  if (isLoading) {
    return (
      <div className="pointer-events-auto">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-md">
          <div className="h-4 w-4 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="pointer-events-auto">
        <button
          className="flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 text-sm font-medium shadow-lg backdrop-blur-md transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => router.push('/')}
        >
          <Home className="h-4 w-4" />
          Home
        </button>
      </div>
    )
  }

  return (
    <div className="pointer-events-auto">
      <ProfileDropdown />
    </div>
  )
}
