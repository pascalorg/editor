import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The dark chrome every page outside the editor shares, so the scenes list,
 * settings and sign-in read as the same product as the editor itself.
 */
export function AppShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'dark min-h-screen bg-sidebar font-sans text-foreground [color-scheme:dark]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function PascalLogo({ className }: { className?: string }) {
  return (
    <Image
      alt="Pascal"
      className={cn('h-5 w-auto invert', className)}
      height={20}
      priority
      src="/pascal-logo-full.svg"
      width={100}
    />
  )
}

export function PascalMark({ className }: { className?: string }) {
  return (
    <Image
      alt=""
      className={cn('h-5 w-5 invert', className)}
      height={20}
      src="/pascal-logo-shape.svg"
      width={20}
    />
  )
}

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-border/50 border-b bg-sidebar">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
        <Link
          aria-label="Pascal home"
          className="-mx-2 flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-accent"
          href="/"
        >
          <PascalLogo />
        </Link>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </header>
  )
}

/** A centred card for single-purpose pages (sign-in, setup, not found). */
export function AppCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <AppShell className="flex items-center justify-center p-6">
      <div
        className={cn(
          'w-full max-w-sm rounded-2xl border border-border/60 bg-background p-6 shadow-2xl',
          className,
        )}
      >
        <PascalLogo className="h-4" />
        {children}
      </div>
    </AppShell>
  )
}

export const PRIMARY_PILL =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50'

export const SECONDARY_PILL =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-1.5 font-medium text-foreground text-sm transition-colors hover:bg-accent disabled:opacity-50'

export const ICON_BUTTON =
  'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
