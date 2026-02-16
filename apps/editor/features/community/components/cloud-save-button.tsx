'use client'

import { Cloud, Home } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../lib/auth/hooks'
import { usePropertyStore } from '../lib/properties/store'
import { ProfileDropdown } from './profile-dropdown'
import { SignInDialog } from './sign-in-dialog'

interface CloudSaveButtonProps {
  propertyId?: string
}

/**
 * CloudSaveButton - Shows authentication state and property management
 *
 * Guest with local property: Shows "Save to cloud" button
 * Guest without property: Shows "Home" button
 * Authenticated: Shows ProfileDropdown
 */
export function CloudSaveButton({ propertyId }: CloudSaveButtonProps) {
  const { isAuthenticated, isLoading } = useAuth()
  const [isSignInDialogOpen, setIsSignInDialogOpen] = useState(false)
  const initialize = usePropertyStore(state => state.initialize)
  const router = useRouter()

  const isLocalProperty = propertyId?.startsWith('local_')

  // Initialize property store when authenticated
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

  // Guest user with local property
  if (!isAuthenticated && isLocalProperty) {
    return (
      <>
        <div className="pointer-events-auto">
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

  // Guest user (no property context or browsing)
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

  // Authenticated user
  return (
    <div className="pointer-events-auto">
      <ProfileDropdown />
    </div>
  )
}
