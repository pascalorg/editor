'use client'

import { LayoutDashboard, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useSession } from '@/components/auth/session-provider'

const ROLE_LABEL: Record<'admin' | 'editor' | 'viewer', string> = {
  admin: 'Administrator',
  editor: 'Editor',
  viewer: 'Viewer (read-only)',
}

/**
 * Who is signed in, their access, and a way out — mounted at the top of the
 * editor's built-in Settings panel via `settingsPanelProps.accountSection`.
 *
 * Styled like the rest of the editor's own sidebar tabs (ScenesTab, BuildTab):
 * muted-background rounded buttons, not the console's bordered-card idiom —
 * this panel lives inside the 3D editor, not the admin console.
 */
export function AccountSettingsSection() {
  const router = useRouter()
  const { user, signOut } = useSession()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = useCallback(async () => {
    setSigningOut(true)
    await signOut()
    router.push('/signin')
  }, [router, signOut])

  if (!user) return null

  return (
    <div className="space-y-3">
      <label className="font-medium text-muted-foreground text-xs uppercase">Account</label>

      <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-sm">{user.email}</div>
          <div className="text-muted-foreground text-xs">{ROLE_LABEL[user.role]}</div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {user.role === 'admin' && (
          <button
            className="flex items-center justify-center gap-2 rounded-lg bg-muted/40 px-3 py-2 font-medium text-sm transition-colors hover:bg-muted"
            onClick={() => router.push('/console')}
            type="button"
          >
            <LayoutDashboard className="size-4" />
            Open admin console
          </button>
        )}

        <button
          className="flex items-center justify-center gap-2 rounded-lg bg-muted/40 px-3 py-2 font-medium text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
          type="button"
        >
          <LogOut className="size-4" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  )
}
