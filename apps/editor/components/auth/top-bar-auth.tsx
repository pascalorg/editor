'use client'

import { useTranslation } from '@pascal-app/editor'
import { useState } from 'react'
import { authClient } from '../../lib/auth-client'
import { TOP_BAR_ACTION } from '../editor-top-bar'
import { ProfileMenu } from './profile-menu'
import { SignInDialog } from './sign-in-dialog'

export function TopBarAuth() {
  const t = useTranslation()
  const { data: session, isPending } = authClient.useSession()
  const [signInOpen, setSignInOpen] = useState(false)

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
      </div>
    )
  }

  if (session?.user) {
    return (
      <div className="flex h-full items-center px-4 border-border border-l-2">
        <ProfileMenu user={session.user} />
      </div>
    )
  }

  return (
    <>
      <button className={TOP_BAR_ACTION} onClick={() => setSignInOpen(true)} type="button">
        {t('Sign In')}
      </button>
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </>
  )
}
