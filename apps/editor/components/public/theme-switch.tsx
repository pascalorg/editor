'use client'

import { useCallback, useEffect, useState } from 'react'

type Choice = 'system' | 'light' | 'dark'

const COOKIE = 'digitaltwin_theme'
const CHOICE_COOKIE = 'digitaltwin_theme_choice'
const ORDER: Choice[] = ['system', 'light', 'dark']

/**
 * One button, cycling System → Light → Dark.
 *
 * It starts on System and System means it: the page follows the operating
 * system and keeps following it when the OS flips at dusk. Clicking once
 * pins Light, again Dark, again back to System — an explicit choice then
 * survives the OS changing under it.
 */
export function ThemeSwitch({ labels }: { labels: Record<Choice, string> }) {
  const [choice, setChoice] = useState<Choice>('system')

  const apply = useCallback((next: Choice) => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const resolved = next === 'system' ? (media.matches ? 'dark' : 'light') : next
    // The tokens hang off whichever element carries [data-dt-theme] — the
    // layout's wrapper here, the root element elsewhere. Update every one of
    // them rather than assuming which, or the page keeps whatever the server
    // guessed before the browser could say what it prefers.
    for (const node of document.querySelectorAll<HTMLElement>('[data-dt-theme]')) {
      node.dataset.dtTheme = resolved
    }
    document.documentElement.dataset.dtTheme = resolved
    document.cookie = `${COOKIE}=${resolved}; path=/; max-age=31536000; samesite=lax`
    document.cookie = `${CHOICE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    // The console reads the choice from localStorage and treats it as the
    // authority over the cookie, so a choice made here has to be written to
    // both or signing in would silently undo it.
    try {
      localStorage.setItem(COOKIE, next)
    } catch {
      /* private mode — the cookie still carries the choice */
    }
  }, [])

  useEffect(() => {
    let stored: string | null | undefined
    try {
      stored = localStorage.getItem(COOKIE)
    } catch {
      /* ignore */
    }
    stored ??= document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${CHOICE_COOKIE}=`))
      ?.split('=')[1]
    const initial: Choice = ORDER.includes(stored as Choice) ? (stored as Choice) : 'system'
    setChoice(initial)
    apply(initial)
  }, [apply])

  // Only "system" listens: an explicit choice must survive the OS changing.
  useEffect(() => {
    if (choice !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [choice, apply])

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? 'system'
    setChoice(next)
    apply(next)
  }

  return (
    <button
      aria-label={labels[choice]}
      className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-[12px] text-muted-fg transition-colors hover:text-fg"
      onClick={cycle}
      title={labels[choice]}
      type="button"
    >
      {choice === 'system' ? '◐' : choice === 'light' ? '☀' : '☾'}
    </button>
  )
}
