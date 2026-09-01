'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import en from './i18n/en.json'
import zh from './i18n/zh.json'

export type Locale = 'en' | 'zh'

function getDefaultLocale(): Locale {
  // Browser locale decides — there's no in-app switcher. Falls through
  // to 'en' on any non-zh navigator.language (e.g. en-US, ja-JP).
  if (typeof navigator === 'undefined') return 'en'
  const lang = navigator.language.toLowerCase()
  return lang.startsWith('zh') ? 'zh' : 'en'
}

export const defaultLocale: Locale = getDefaultLocale()

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
  const [locale, setLocale] = useState<Locale>(getDefaultLocale())

  return (
    <I18nContext.Provider value={{ locale, setLocale }}>
      <IntlProvider messages={messages[locale]} locale={locale} defaultLocale={locale}>
        {children}
      </IntlProvider>
    </I18nContext.Provider>
  )
}

export { messages }
