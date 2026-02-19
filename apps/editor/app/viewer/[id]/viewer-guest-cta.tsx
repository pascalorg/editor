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
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
        <div className="bg-white/90 backdrop-blur-sm rounded-xl rounded-smooth-xl px-6 py-3 shadow-[0_4px_16px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.03)] flex items-center gap-4">
          <p className="text-sm text-neutral-700">Want to create your own 3D project?</p>
          <button
            onClick={() => setShowSignIn(true)}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            Get Started
          </button>
        </div>
      </div>
      <SignInDialog open={showSignIn} onOpenChange={setShowSignIn} />
    </>
  )
}
