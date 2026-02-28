'use client'

import { useState } from 'react'
import { useAuth } from '@/features/community/lib/auth/hooks'
import { SignInDialog } from '@/features/community/components/sign-in-dialog'

export function ViewerGuestCTA() {
  const { isAuthenticated, isLoading } = useAuth()
  const [showSignIn, setShowSignIn] = useState(false)

  if (isLoading || isAuthenticated) return null

  return (
    <>
      <div className="absolute top-4 right-4 z-20 dark text-foreground">
        <div className="pointer-events-auto bg-background/95 backdrop-blur-xl border border-border/40 rounded-2xl px-6 py-3 shadow-lg transition-colors duration-200 ease-out flex flex-col sm:flex-row items-center gap-4">
          <p className="text-sm font-medium text-foreground text-center">Want to create your own 3D project?</p>
          <button
            onClick={() => setShowSignIn(true)}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors whitespace-nowrap w-full sm:w-auto"
          >
            Get Started
          </button>
        </div>
      </div>
      <SignInDialog open={showSignIn} onOpenChange={setShowSignIn} />
    </>
  )
}
