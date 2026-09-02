'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import en from './i18n/en.json'
import zh from './i18n/zh.json'

export type Locale = 'en' | 'zh'

function detectBrowserLocale(): Locale {
  // Browser locale decides — there's no in-app switcher. Falls through
  // to 'en' on any non-zh navigator.language (e.g. en-US, ja-JP).
  if (typeof navigator === 'undefined') return 'en'
  const lang = navigator.language.toLowerCase()
  return lang.startsWith('zh') ? 'zh' : 'en'
}

/**
 * Default used during SSR and before client-side detection runs. Always 'en'
 * so the server-rendered HTML and the first client render agree (no hydration
 * mismatch); `I18nProvider` re-reads `navigator.language` in `useEffect` and
 * flips to `zh` if the browser is Chinese-locale.
 */
export const defaultLocale: Locale = 'en'

const messages: Record<Locale, Record<string, string>> = { en, zh }

interface I18nContextType {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18nContextType>({
  locale: defaultLocale,
  setLocale: () => {},
})

export function useLocale() {
  return useContext(I18nContext)
}

export function useTranslations() {
  const { locale } = useContext(I18nContext)
  return useMemo<Translator>(
    () =>
      (key: string, params?: Record<string, string | number>): string => {
        const str = messages[locale][key] ?? key
        if (!params) return str
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
          str,
        )
      },
    [locale],
  )
}

export type Translator = (
  key: string,
  params?: Record<string, string | number>,
) => string

export function I18nProvider({ children }: { children: ReactNode }) {
  // Seed with the SSR-safe default; swap to the browser locale after mount
  // so the initial client render matches the server HTML byte-for-byte.
  const [locale, setLocale] = useState<Locale>(defaultLocale)

  useEffect(() => {
    const detected = detectBrowserLocale()
    if (detected !== locale) setLocale(detected)
    // We only want this to run once on mount; locale changes are driven by
    // setLocale below, not by re-detecting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <I18nContext.Provider value={{ locale, setLocale }}>
      <IntlProvider messages={messages[locale]} locale={locale} defaultLocale={locale}>
        {children}
      </IntlProvider>
    </I18nContext.Provider>
  )
}

export { messages }
