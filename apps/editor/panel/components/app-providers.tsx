'use client'

import { DEFAULT_LANG, type Dictionary, dictionaryFor } from '@panel/lib/i18n'
import type { Lang, Theme } from '@panel/lib/types'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const THEME_KEY = 'digitaltwin_theme'
const CHOICE_KEY = 'digitaltwin_theme_choice'
const LANG_KEY = 'digitaltwin_lang'

interface AppShell {
  theme: Theme
  /** What the person picked; 'system' follows the OS and keeps following it. */
  themeChoice: Theme | 'system'
  lang: Lang
  t: Dictionary
  toggleTheme: () => void
  setThemeChoice: (choice: Theme | 'system') => void
  toggleLang: () => void
  setTheme: (theme: Theme) => void
  setLang: (lang: Lang) => void
}

const Ctx = createContext<AppShell | null>(null)

export function useApp(): AppShell {
  const value = useContext(Ctx)
  if (!value) throw new Error('useApp must be used inside <AppProviders>')
  return value
}

/** Convenience for components that only need the dictionary. */
export function useT(): Dictionary {
  return useApp().t
}

export function AppProviders({
  initialTheme,
  initialLang,
  children,
}: {
  initialTheme: Theme
  initialLang: Lang
  children: React.ReactNode
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)
  const [choice, setChoiceState] = useState<Theme | 'system'>('system')
  const [lang, setLangState] = useState<Lang>(initialLang)

  /**
   * The `lang` attribute drives screen-reader pronunciation, hyphenation and
   * font selection, so it tracks the dictionary.
   *
   * It is deliberately NOT what capitalisation depends on. `text-transform:
   * uppercase` is specified to follow the document language, but Chromium still
   * renders İŞLEMCİ as ISLEMCI under lang="tr" — so every uppercase label goes
   * through <Caps>, which uses toLocaleUpperCase and cannot silently regress.
   */
  useEffect(() => {
    document.documentElement.lang = lang
    // The tokens hang off whichever element carries [data-dt-theme] — the
    // layout wrapper renders on the server and cannot re-render from client
    // state, so every one of them is updated rather than just the root.
    for (const node of document.querySelectorAll<HTMLElement>('[data-dt-theme]')) {
      node.dataset.dtTheme = theme
    }
    document.documentElement.dataset.dtTheme = theme
  }, [lang, theme])

  /**
   * Writes the resolved theme (what the server should render next time) and
   * separately what the person actually chose. "system" is the default and
   * keeps meaning system: the OS flipping at dusk moves the page with it,
   * while an explicit light or dark survives that.
   */
  const persist = useCallback((resolved: Theme, choice: Theme | 'system') => {
    setThemeState(resolved)
    try {
      localStorage.setItem(THEME_KEY, choice)
      document.cookie = `${THEME_KEY}=${resolved};path=/;max-age=31536000;samesite=lax`
      document.cookie = `${CHOICE_KEY}=${choice};path=/;max-age=31536000;samesite=lax`
    } catch {
      /* private mode — the in-memory state still works for this tab */
    }
  }, [])

  const setTheme = useCallback(
    (next: Theme) => {
      persist(next, next)
    },
    [persist],
  )

  const setThemeChoice = useCallback(
    (next: Theme | 'system') => {
      const resolved =
        next === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : next
      setChoiceState(next)
      persist(resolved, next)
    },
    [persist],
  )

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(LANG_KEY, next)
      document.cookie = `${LANG_KEY}=${next};path=/;max-age=31536000;samesite=lax`
    } catch {
      /* ignore */
    }
  }, [])

  // Reconcile once on mount: the server rendered from a cookie, but the stored
  // choice — or, when there is none, the OS — is the authority.
  useEffect(() => {
    let stored: string | null = null
    let storedLang: string | null = null
    try {
      stored = localStorage.getItem(THEME_KEY)
      storedLang = localStorage.getItem(LANG_KEY)
    } catch {
      /* ignore */
    }

    const initial: Theme | 'system' =
      stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system'
    setChoiceState(initial)
    setThemeChoice(initial)

    if ((storedLang === 'en' || storedLang === 'tr') && storedLang !== lang) setLang(storedLang)
    // Mount-only on purpose — this reconciles the server guess, it does not track changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only "system" listens; an explicit choice must outlive the OS changing.
  useEffect(() => {
    if (choice !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setThemeChoice('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [choice, setThemeChoice])

  const value = useMemo<AppShell>(
    () => ({
      theme,
      themeChoice: choice,
      lang,
      t: dictionaryFor(lang),
      toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      setThemeChoice,
      toggleLang: () => setLang(lang === 'en' ? 'tr' : 'en'),
      setTheme,
      setLang,
    }),
    [theme, choice, lang, setTheme, setThemeChoice, setLang],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export { CHOICE_KEY, DEFAULT_LANG, LANG_KEY, THEME_KEY }
