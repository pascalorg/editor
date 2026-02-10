'use client'

import { useAuth } from '../lib/auth/hooks'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/primitives/dropdown-menu'

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/**
 * ProfileDropdown - User profile menu with sign out
 */
export function ProfileDropdown() {
  const { user, signOut } = useAuth()

  const handleSignOut = async () => {
    await signOut()
    // TODO: Show sign-in dialog or redirect
    console.log('Signed out')
  }

  const initials = user?.name ? getInitials(user.name) : user?.email?.[0]?.toUpperCase() || 'U'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/95 font-medium text-sm shadow-lg backdrop-blur-md transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none"
          type="button"
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {user?.name && (
          <div className="px-2 py-1.5 text-sm">
            <div className="font-medium">{user.name}</div>
            {user.email && <div className="text-muted-foreground text-xs">{user.email}</div>}
          </div>
        )}
        {user?.name && <DropdownMenuItem className="h-px bg-border" />}
        <DropdownMenuItem className="cursor-pointer" variant="destructive" onClick={handleSignOut}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
