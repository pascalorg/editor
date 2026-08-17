'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useTranslation,
} from '@pascal-app/editor'
import { LogOut, Settings } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { authClient } from '../../lib/auth-client'

export interface ProfileMenuProps {
  user: {
    id: string
    name: string
    email: string
    image?: string | null
  }
}

export function ProfileMenu({ user }: ProfileMenuProps) {
  const t = useTranslation()
  const router = useRouter()

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push('/') // Or just reload
          router.refresh()
        },
      },
    })
  }

  const initial = user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground outline-none ring-offset-background transition-colors hover:bg-accent/80 focus-visible:ring-2 focus-visible:ring-ring">
          {user.image ? (
            <Image
              src={user.image}
              alt={user.name || user.email}
              width={32}
              height={32}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            <span className="font-semibold text-xs">{initial}</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex items-center justify-start gap-2 p-2">
          <div className="flex flex-col space-y-1 leading-none">
            {user.name && <p className="font-medium text-sm">{user.name}</p>}
            <p className="w-[200px] truncate text-muted-foreground text-xs">{user.email}</p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/settings" className="flex cursor-pointer items-center">
            <Settings className="mr-2 h-4 w-4" />
            <span>{t('Account Settings')}</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>{t('Sign out')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
