'use client'

import { MenuIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'

import { BrandIcon } from '@/components/site/brand-icon'
import { DocsSearch } from '@/components/site/docs-search'
import { LogoLockup, LogoMark } from '@/components/site/logo'
import { ThemeToggle } from '@/components/site/theme-toggle'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { docsTopLevelPages } from '@/lib/docs-catalog'
import { cn } from '@/lib/utils'

const primaryLinks = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
] as const

const githubHref = 'https://github.com/pascalorg/lingo'
const githubStarsApiPath = '/api/github-stars'
const initialGitHubStars = 0
const headerControlTextClass = 'font-medium text-[13px] leading-none tracking-normal'

const resourceLinks = [
  { href: '/llms.txt', label: 'llms.txt' },
  { href: githubHref, label: 'GitHub', brand: 'github' },
  { href: 'https://www.npmjs.com/package/@pascal-app/lingo', label: 'npm', brand: 'npm' },
] as const

function coerceStarCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function readGitHubStarsResponse(value: unknown) {
  if (!value || typeof value !== 'object' || !('stars' in value)) {
    return initialGitHubStars
  }

  return coerceStarCount(value.stars)
}

function formatGitHubStars(stars: number) {
  const count = coerceStarCount(stars)

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: count < 1000 ? 0 : 1,
    notation: 'compact',
  }).format(count)
}

function getGitHubStarsDescription(stars: number) {
  const count = coerceStarCount(stars)
  const label = formatGitHubStars(count)
  const noun = count === 1 ? 'star' : 'stars'

  return `GitHub repository, ${label} ${noun}`
}

function useGitHubStars() {
  const [stars, setStars] = useState(initialGitHubStars)

  useEffect(() => {
    const controller = new AbortController()

    async function loadStars() {
      try {
        const response = await fetch(githubStarsApiPath, { signal: controller.signal })

        if (!response.ok) {
          return
        }

        const data: unknown = await response.json()
        setStars(readGitHubStarsResponse(data))
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
      }
    }

    void loadStars()

    return () => controller.abort()
  }, [])

  return stars
}

function isActivePath(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

function HeaderNavLink({
  href,
  label,
  pathname,
}: {
  href: string
  label: string
  pathname: string
}) {
  const active = isActivePath(pathname, href)

  return (
    <Link
      aria-current={active ? 'page' : undefined}
      className={cn(
        buttonVariants({
          className: cn(
            'h-8 px-2.5 text-muted-foreground shadow-none hover:text-foreground',
            headerControlTextClass,
            active && 'bg-[var(--control-muted-hover)] text-foreground',
          ),
          size: 'sm',
          variant: 'ghost',
        }),
      )}
      href={href}
    >
      {label}
    </Link>
  )
}

function HeaderUtilityLink({
  href,
  label,
  brand,
  className,
}: {
  href: string
  label: string
  brand?: 'github' | 'npm'
  className?: string
}) {
  return (
    <a
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        headerControlTextClass,
        className,
      )}
      href={href}
    >
      {brand ? (
        <BrandIcon brand={brand} className="size-3.5 opacity-70" data-icon="inline-start" />
      ) : null}
      {label}
    </a>
  )
}

function GitHubStarsLink({ className, stars }: { className?: string; stars: number }) {
  const starsLabel = formatGitHubStars(stars)
  const starsDescription = getGitHubStarsDescription(stars)

  return (
    <a
      aria-label={starsDescription}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        headerControlTextClass,
        className,
      )}
      href={githubHref}
      title={starsDescription}
    >
      <BrandIcon brand="github" className="size-4 opacity-70" data-icon="inline-start" />
      <span className="tabular-nums tracking-normal">{starsLabel}</span>
    </a>
  )
}

function MobileNavLink({
  active,
  children,
  href,
  onNavigate,
}: {
  active?: boolean
  children: ReactNode
  href: string
  onNavigate: () => void
}) {
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 items-center rounded-lg px-3 py-2 font-medium text-base outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-[var(--control-muted-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        active ? 'bg-[var(--control-muted-hover)] text-foreground' : 'text-muted-foreground',
      )}
      href={href}
      onClick={onNavigate}
    >
      {children}
    </Link>
  )
}

function MobileResourceLink({
  ariaLabel,
  href,
  label,
  brand,
  suffix,
  onNavigate,
}: {
  ariaLabel?: string
  href: string
  label: string
  brand?: 'github' | 'npm'
  suffix?: string
  onNavigate: () => void
}) {
  return (
    <a
      aria-label={ariaLabel}
      className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 font-medium text-muted-foreground text-sm outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-[var(--control-muted-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      href={href}
      onClick={onNavigate}
    >
      {brand ? (
        <BrandIcon brand={brand} className="size-4 opacity-70" data-icon="inline-start" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {suffix ? (
        <span className="font-mono text-muted-foreground tabular-nums tracking-normal">
          {suffix}
        </span>
      ) : null}
    </a>
  )
}

function MobileNav({ githubStars, pathname }: { githubStars: number; pathname: string }) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const githubStarsLabel = formatGitHubStars(githubStars)
  const githubStarsDescription = getGitHubStarsDescription(githubStars)

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button
            aria-label="Open navigation"
            className="size-10 rounded-lg md:hidden"
            size="icon-lg"
            type="button"
            variant="ghost"
          />
        }
      >
        <MenuIcon aria-hidden="true" />
      </DialogTrigger>
      <DialogContent
        className="inset-x-0 top-14 bottom-0 left-0 h-[calc(100dvh-3.5rem)] max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-border border-t bg-background/95 p-0 shadow-none ring-0 backdrop-blur data-closed:scale-100 data-open:scale-100 md:hidden"
        showCloseButton={false}
      >
        <div className="flex h-full flex-col overflow-y-auto px-4 py-4">
          <DialogHeader className="mb-3 flex-row items-start justify-between gap-3">
            <div>
              <DialogTitle>Navigation</DialogTitle>
              <DialogDescription className="mt-1">
                Docs, references, and package links.
              </DialogDescription>
            </div>
            <DialogClose
              render={
                <Button
                  aria-label="Close navigation"
                  className="size-10 rounded-lg"
                  size="icon-lg"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <XIcon aria-hidden="true" />
            </DialogClose>
          </DialogHeader>

          <nav aria-label="Primary" className="grid gap-1">
            {primaryLinks.map((item) => (
              <MobileNavLink
                active={isActivePath(pathname, item.href)}
                href={item.href}
                key={item.href}
                onNavigate={close}
              >
                {item.label}
              </MobileNavLink>
            ))}
          </nav>

          <div className="mt-6">
            <div className="px-3 font-semibold text-[11px] text-muted-foreground uppercase">
              Resources
            </div>
            <div className="mt-2 grid gap-1">
              {resourceLinks.map((item) => (
                <MobileResourceLink
                  ariaLabel={item.href === githubHref ? githubStarsDescription : undefined}
                  brand={'brand' in item ? item.brand : undefined}
                  href={item.href}
                  key={item.href}
                  label={item.label}
                  onNavigate={close}
                  suffix={item.href === githubHref ? githubStarsLabel : undefined}
                />
              ))}
            </div>
          </div>

          <div className="mt-6 pb-6">
            <div className="px-3 font-semibold text-[11px] text-muted-foreground uppercase">
              Docs sections
            </div>
            <div className="mt-2 grid gap-1">
              {docsTopLevelPages.map((item) => (
                <MobileNavLink href={item.href} key={item.id} onNavigate={close}>
                  {item.title}
                </MobileNavLink>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SiteHeader() {
  const pathname = usePathname()
  const githubStars = useGitHubStars()

  return (
    <header className="sticky inset-x-0 top-0 z-40 h-14 border-border border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          className="inline-flex shrink-0 items-center rounded-md outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          href="/"
        >
          <LogoMark className="h-5 sm:hidden" title="lingo" />
          <LogoLockup className="hidden text-[1.25rem] sm:block" />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-0 md:flex">
          {primaryLinks.map((item) => (
            <HeaderNavLink
              href={item.href}
              key={item.href}
              label={item.label}
              pathname={pathname}
            />
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <DocsSearch
            className={cn(
              'size-10 justify-center px-0 md:h-8 md:w-52 md:justify-start md:px-3 lg:w-60 xl:w-72',
            )}
          />
          <HeaderUtilityLink className="hidden lg:inline-flex" href="/llms.txt" label="llms.txt" />
          <GitHubStarsLink className="hidden md:inline-flex" stars={githubStars} />
          <a
            aria-label="npm package"
            className={cn(
              buttonVariants({
                className: cn(
                  'hidden h-8 px-2.5 text-muted-foreground hover:text-foreground sm:inline-flex',
                  headerControlTextClass,
                ),
                size: 'sm',
                variant: 'ghost',
              }),
            )}
            href="https://www.npmjs.com/package/@pascal-app/lingo"
            title="npm package"
          >
            <BrandIcon brand="npm" className="size-3.5 opacity-70" data-icon="inline-start" />
            npm
          </a>
          <ThemeToggle className="size-10 rounded-lg md:size-9" />
          <MobileNav githubStars={githubStars} pathname={pathname} />
        </div>
      </div>
    </header>
  )
}
