'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth/hooks'
import { getUsername } from '../lib/auth/actions'
import { UsernameOnboardingDialog } from './username-onboarding-dialog'

export function UsernameGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const [needsUsername, setNeedsUsername] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      setChecking(false)
      setNeedsUsername(false)
      return
    }
    getUsername()
      .then((username) => {
        setNeedsUsername(!username)
        setChecking(false)
      })
      .catch(() => {
        setNeedsUsername(false)
        setChecking(false)
      })
  }, [isAuthenticated, isLoading])

  return (
    <>
      {children}
      <UsernameOnboardingDialog
        open={needsUsername && !checking}
        onComplete={() => setNeedsUsername(false)}
      />
    </>
  )
}
