'use client'

import { useCallback, useEffect, useState } from 'react'

type Choice = 'system' | 'light' | 'dark'

const COOKIE = 'digitaltwin_theme'
const CHOICE_COOKIE = 'digitaltwin_theme_choice'

/**
 * System / Light / Dark, in that order — “system” is the default and means
 * exactly that: the page follows the operating system and keeps following it
 * when the OS flips at dusk, rather than freezing whatever it was at first
 * paint. The resolved value is mirrored into a cookie so the server renders
 * the same theme on the next request and the page never flashes.
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
  }, [])

  useEffect(() => {
    const stored = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${CHOICE_COOKIE}=`))
      ?.split('=')[1] as Choice | undefined
    const initial: Choice =
      stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
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

  const pick = (next: Choice) => {
    setChoice(next)
    apply(next)
  }

  return (
    <div
      aria-label="Theme"
      className="flex items-center gap-px rounded-full border border-border bg-surface p-[2px]"
      role="group"
    >
      {(['system', 'light', 'dark'] as const).map((option) => (
        <button
          aria-pressed={choice === option}
          className={`cursor-pointer rounded-full px-[9px] py-[3px] text-[11px] transition-colors ${
            choice === option ? 'bg-hover text-fg' : 'text-muted-fg hover:text-fg'
          }`}
          key={option}
          onClick={() => pick(option)}
          title={labels[option]}
          type="button"
        >
          {option === 'system' ? '◐' : option === 'light' ? '☀' : '☾'}
          <span className="sr-only">{labels[option]}</span>
        </button>
      ))}
    </div>
  )
}
