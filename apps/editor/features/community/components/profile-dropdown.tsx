'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useAuth } from '../lib/auth/hooks'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
 * ProfileDropdown - User profile menu with avatar, settings, and sign out
 */
export function ProfileDropdown() {
  const { user, signOut } = useAuth()
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut()
  }

  const initials = user?.name ? getInitials(user.name) : user?.email?.[0]?.toUpperCase() || 'U'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-xs shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.1)] transition-opacity hover:opacity-80 focus:outline-none"
          type="button"
        >
          {user?.image ? (
            <Image
              src={user.image}
              alt={user.name || 'Profile'}
              width={36}
              height={36}
              className="h-full w-full object-cover"
            />
          ) : (
            initials
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex items-center gap-3 px-2 py-2">
          {user?.image ? (
            <Image
              src={user.image}
              alt={user.name || 'Profile'}
              width={32}
              height={32}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted font-medium text-xs">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {user?.name && <div className="truncate font-medium text-sm">{user.name}</div>}
            {user?.email && (
              <div className="truncate text-muted-foreground text-xs">{user.email}</div>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer" onClick={() => router.push('/settings')}>
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer" variant="destructive" onClick={handleSignOut}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
