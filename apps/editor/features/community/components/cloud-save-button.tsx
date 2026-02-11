'use client'

import { Cloud } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth/hooks'
import { usePropertyStore } from '../lib/properties/store'
import { ProfileDropdown } from './profile-dropdown'
import { PropertyDropdown } from './property-dropdown'
import { SignInDialog } from './sign-in-dialog'

/**
 * CloudSaveButton - Shows authentication state and property management
 *
 * Not authenticated: Shows "Save to cloud" button
 * Authenticated: Shows PropertyDropdown and ProfileDropdown
 */
export function CloudSaveButton() {
  const { isAuthenticated, isLoading } = useAuth()
  const [isSignInDialogOpen, setIsSignInDialogOpen] = useState(false)
  const initialize = usePropertyStore(state => state.initialize)

  // Initialize property store when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      initialize()
    }
  }, [isAuthenticated, initialize])

  if (isLoading) {
    return (
      <div className="pointer-events-auto fixed top-4 right-4 z-50">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-md">
          <div className="h-4 w-4 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <>
        <div className="pointer-events-auto fixed top-4 right-4 z-50">
          <button
            className="flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 text-sm font-medium shadow-lg backdrop-blur-md transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => setIsSignInDialogOpen(true)}
          >
            <Cloud className="h-4 w-4" />
            Save to cloud
          </button>
        </div>
        <SignInDialog open={isSignInDialogOpen} onOpenChange={setIsSignInDialogOpen} />
      </>
    )
  }

  return (
    <div className="pointer-events-auto fixed top-4 right-4 z-50">
      <div className="flex items-center gap-2">
        <PropertyDropdown />
        <ProfileDropdown />
      </div>
    </div>
  )
}
