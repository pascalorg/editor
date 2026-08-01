'use client'

import { useApp } from '@panel/components/app-providers'
import { CommandPalette } from '@panel/components/console/command-palette'
import { Caps } from '@panel/components/ui/caps'
import { Button, LangToggle, ThemeToggle } from '@panel/components/ui/controls'
import { Dialog, Toast } from '@panel/components/ui/feedback'
import { BrandLockup } from '@panel/components/ui/netlog-logo'
import type { SessionResponse, TouchResponse } from '@panel/lib/api-contract'
import { call } from '@panel/lib/client-api'
import { cn } from '@panel/lib/cn'
import { type ConsoleTab, railEntries, tabLabel } from '@panel/lib/console-tabs'
import { useEscapeLayer } from '@panel/lib/escape-layers'
import { useBreakpoint } from '@panel/lib/hooks/use-breakpoint'
import type { SessionUser } from '@panel/lib/types'
import { ChevronDown, Clock, Search } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Warning appears two minutes before the idle limit — the figure from WP4. */
const WARN_AT_SECONDS = 120
const POLL_MS = 30_000

export function ConsoleShell({
  user: initialUser,
  tab,
  children,
}: {
  user: SessionUser
  tab: ConsoleTab
  children: React.ReactNode
}) {
  const { t } = useApp()
  const router = useRouter()
  const pathname = usePathname()
  const { isWide, isMobile, touch } = useBreakpoint()

  const [user] = useState(initialUser)
  const [navOpen, setNavOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)
  const signingOut = useRef(false)

  const rail = useMemo(
    () => railEntries(t).filter((e) => !e.permission || user.permissions.includes(e.permission)),
    [t, user.permissions],
  )

  const signOut = useCallback(
    async (reason: 'user' | 'idle') => {
      if (signingOut.current) return
      signingOut.current = true
      await call('/api/auth/signout', { body: { allDevices: false } })
      router.push(reason === 'idle' ? '/signin?expired=1' : '/signin')
    },
    [router],
  )

  /**
   * The countdown is server-owned: every poll replaces the local number with
   * `expiresInSeconds` from the API. Ticking it down locally between polls is
   * only there to make the dialog count smoothly.
   */
  useEffect(() => {
    let cancelled = false

    const sync = async () => {
      // A hidden tab must not keep the session alive — the poll is activity.
      if (document.visibilityState === 'hidden') return
      const res = await call<SessionResponse>('/api/auth/session')
      if (cancelled) return
      if (!res.ok) return
      if (res.data.state === 'anonymous') {
        void signOut('idle')
        return
      }
      setSecondsLeft(res.data.expiresInSeconds)
    }

    // Named, so the listener can actually be removed again — an inline arrow
    // here leaks one listener per remount.
    const onVisibility = () => void sync()

    void sync()
    const poll = setInterval(() => void sync(), POLL_MS)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [signOut])

  // Local tick between polls, purely so the countdown reads smoothly. The poll
  // above is what the number is actually anchored to.
  const counting = secondsLeft !== null
  useEffect(() => {
    if (!counting) return
    const tick = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null) return prev
        if (prev <= 1) {
          void signOut('idle')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [counting, signOut])

  const idleWarning = secondsLeft !== null && secondsLeft <= WARN_AT_SECONDS && secondsLeft > 0

  const staySignedIn = useCallback(async () => {
    const res = await call<TouchResponse>('/api/auth/session/touch', { body: {} })
    if (!res.ok) {
      void signOut('idle')
      return
    }
    setSecondsLeft(res.data.expiresInSeconds)
    setToast({ message: t.idleExtended, tone: 'success' })
    setTimeout(() => setToast(null), 2400)
  }, [signOut, t])

  /**
   * Escape chain: menu → command palette → drawer → dialog → inline edit. Only
   * the topmost layer closes per press. Ordering comes from the layer stack in
   * `@/lib/escape-layers` — mounting order is nesting order, so no layer has to
   * know what sits above it.
   */
  const closeNav = useCallback(() => setNavOpen(false), [])
  useEscapeLayer(navOpen, closeNav)

  /**
   * ⌘K on macOS, Ctrl+K elsewhere. Bound at the window so it works from any
   * tab, and `preventDefault` because Ctrl+K is Chrome's address-bar search.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setPaletteOpen((open) => !open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const closePalette = useCallback(() => setPaletteOpen(false), [])

  // Dismiss the "Go to" menu on any outside click, matching CustomSelect.
  useEffect(() => {
    if (!navOpen) return
    const onClick = () => setNavOpen(false)
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [navOpen])

  const goto = useCallback(
    (next: ConsoleTab) => {
      if (pathname !== `/console/${next}`) router.push(`/console/${next}`)
    },
    [pathname, router],
  )

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toLocaleUpperCase('tr')

  return (
    <div data-screen-label="Admin console" className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="relative z-40 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-sidebar px-3">
        <BrandLockup
          label="Console"
          meta={isWide ? 'ADMIN · V0.9.1' : undefined}
          logoClassName="h-[26px] w-auto"
          labelClassName="text-[13px] font-semibold"
        />

        <div className="flex shrink-0 items-center gap-[7px]">
          {isWide ? (
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              title={t.a11yPalette}
              aria-label={t.a11yPalette}
              className={cn(
                'flex shrink-0 items-center gap-[6px] whitespace-nowrap border border-border bg-field px-[9px] font-medium text-fg hover:bg-hover',
                touch ? 'h-11 rounded-[10px]' : 'h-7 rounded-[8px]',
              )}
            >
              <Search className="block h-3 w-3 shrink-0 text-muted-fg" strokeWidth={2.2} />
              <span className="text-[11.5px] text-muted-fg">{t.c.search}</span>
              <span className="rounded-[4px] bg-hover px-1 py-px font-mono text-[9px] text-muted-fg">
                ⌘K
              </span>
            </button>
          ) : null}

          <LangToggle />
          <ThemeToggle />

          {/* "Go to" is hidden on mobile: the tab strip below the header already
              lists every destination, and at 402 px the extra control pushed the
              brand label out of the header entirely. */}
          {isWide ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setNavOpen((v) => !v)
                }}
                aria-expanded={navOpen}
                className={cn(
                  'flex shrink-0 items-center gap-[6px] whitespace-nowrap border border-border bg-field px-[9px] text-[11.5px] font-medium text-fg hover:bg-hover',
                  touch ? 'h-11 rounded-[10px]' : 'h-7 rounded-[8px]',
                )}
              >
                <span>{t.c.goTo}</span>
                <ChevronDown
                  className={cn(
                    'block h-3 w-3 shrink-0 text-muted-fg transition-transform',
                    navOpen && 'rotate-180',
                  )}
                  strokeWidth={2.5}
                />
              </button>

              {navOpen ? (
                <div
                  className="absolute right-0 top-8 z-[70] w-[172px] rounded-[10px] border border-border bg-popover p-1 shadow-e4"
                  style={{ animation: 'dtDrop 0.14s ease' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {rail
                    .filter((entry) => entry.kind === 'item')
                    .slice(0, 5)
                    .map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          setNavOpen(false)
                          goto(entry.id!)
                        }}
                        className="flex h-[30px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-xs font-medium text-fg hover:bg-hover"
                      >
                        <span className="h-1 w-1 shrink-0 rounded-full bg-brand" />
                        <span>{entry.label}</span>
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex shrink-0 items-center gap-2 rounded-[8px] border border-border bg-field px-2 py-1">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-hover text-[9px] font-semibold text-brand-fg">
              {initials}
            </span>
            {isWide ? (
              <span className="whitespace-nowrap text-[11.5px] font-medium text-fg">
                {user.name}
              </span>
            ) : null}
          </div>

          {/* The console and the editor are one product; an administrator
              standing in the console should not have to type a URL to get
              back to the work itself. */}
          <a
            className={cn(
              'flex shrink-0 items-center whitespace-nowrap rounded-[8px] bg-brand px-[10px] font-medium text-[11.5px] text-[#18181b] no-underline transition-opacity hover:opacity-90',
              touch ? 'h-11 rounded-[10px]' : 'h-7',
            )}
            href="/"
          >
            {t.c.openEditor}
          </a>

          <button
            type="button"
            onClick={() => void signOut('user')}
            className={cn(
              'shrink-0 whitespace-nowrap border border-destructive bg-field px-[10px] text-[11.5px] font-medium text-destructive hover:bg-hover',
              touch ? 'h-11 rounded-[10px]' : 'h-7 rounded-[8px]',
            )}
          >
            {isWide ? t.c.signOut : t.c.signOutShort}
          </button>
        </div>
      </header>

      {isMobile ? (
        <nav className="dt-scroll-x flex shrink-0 items-center gap-[2px] border-b border-border bg-sidebar px-[10px] py-2">
          {rail
            .filter((entry) => entry.kind === 'item')
            .map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => goto(entry.id!)}
                aria-current={entry.id === tab ? 'page' : undefined}
                className={cn(
                  'h-11 whitespace-nowrap rounded-[6px] px-[10px] text-[11px] font-medium',
                  entry.id === tab
                    ? 'bg-panel-hi text-fg shadow-e2'
                    : 'bg-transparent text-muted-fg',
                )}
              >
                {entry.label}
              </button>
            ))}
        </nav>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1">
        {isWide ? (
          <nav className="flex w-[208px] shrink-0 flex-col gap-px border-r border-border bg-sidebar px-2 py-[10px]">
            {rail.map((entry, index) =>
              entry.kind === 'heading' ? (
                <div key={`h-${index}`} className="px-2 pb-[3px] pt-[11px]">
                  <Caps className="font-mono text-[8.5px] tracking-[0.14em] text-muted-fg">
                    {entry.label}
                  </Caps>
                </div>
              ) : (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => goto(entry.id!)}
                  aria-current={entry.id === tab ? 'page' : undefined}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-[9px] rounded-[7px] px-2 font-medium',
                    touch ? 'h-11 text-[13px]' : 'h-[30px] text-[12.5px]',
                    entry.id === tab
                      ? 'bg-panel text-fg'
                      : 'bg-transparent text-muted-fg hover:text-fg',
                  )}
                >
                  <span
                    className="h-[5px] w-[5px] shrink-0 rounded-full"
                    style={{ background: entry.id === tab ? 'var(--dt-brand)' : 'var(--dt-input)' }}
                  />
                  <span className="truncate">{entry.label}</span>
                </button>
              ),
            )}

            <div className="mt-auto flex flex-col gap-1 px-2 pb-1 pt-4">
              <Caps className="font-mono text-[8.5px] tracking-[0.14em] text-muted-fg">
                {t.c.buildLabel}
              </Caps>
              <span className="flex items-center gap-[6px] font-mono text-[8.5px] tracking-[0.14em] text-muted-fg">
                <span
                  className="h-[5px] w-[5px] rounded-full bg-brand"
                  style={{ animation: 'dtPulse 2s ease infinite' }}
                />
                <Caps>{t.c.webgpuHealthy}</Caps>
              </span>
            </div>
          </nav>
        ) : null}

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div
            key={tab}
            className="mx-auto w-full max-w-[1180px] px-5 py-6"
            style={{ animation: 'dtFade 0.18s ease' }}
          >
            <h1 className="sr-only">{tabLabel(t, tab)}</h1>
            {children}
          </div>
        </main>
      </div>

      <CommandPalette user={user} open={paletteOpen} onClose={closePalette} />

      {idleWarning ? (
        <Dialog role="alertdialog" labelledBy="dt-idle-title">
          <div className="flex items-center gap-[10px]">
            <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] border border-brand bg-field text-brand-fg">
              <Clock className="block h-[15px] w-[15px]" strokeWidth={2.2} />
            </div>
            <h2 id="dt-idle-title" className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
              {t.idleTitle}
            </h2>
          </div>
          <p className="m-0 text-[12.5px] leading-[1.55] text-muted-fg text-pretty">{t.idleLead}</p>
          <span className="font-mono text-[26px] font-medium tracking-[0.02em] text-fg">
            {formatCountdown(secondsLeft ?? 0)}
          </span>
          <div className="flex flex-col gap-[9px]">
            {/* Mouse movement deliberately does NOT extend the session while this
                is open — only a deliberate click does (WP4). */}
            <Button onClick={() => void staySignedIn()}>{t.idleStay}</Button>
            <Button variant="secondary" onClick={() => void signOut('user')}>
              {t.idleOut}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  )
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
