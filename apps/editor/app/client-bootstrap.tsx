'use client'

import {
  type CompiledTranslationMessages,
  createI18n,
  defaultI18n,
  PascalI18nProvider,
  registerCompiledMessages,
} from '@pascal-app/core'
import { loadBundledLocale, registerEnglishLocale } from '@pascal-app/editor/locales/lazy'
import { type ReactNode, useEffect, useMemo } from 'react'
import { loadDevLocale } from '@/lib/dev-locales'

registerEnglishLocale()

const registeredInitialLocales = new Set<string>()

export function ClientBootstrap({
  children,
  enableDevDiagnostics,
  initialLocaleCatalog,
  locale,
}: {
  children: ReactNode
  enableDevDiagnostics: boolean
  initialLocaleCatalog?: { locale: string; messages: CompiledTranslationMessages }
  locale: string
}) {
  if (initialLocaleCatalog && !registeredInitialLocales.has(initialLocaleCatalog.locale)) {
    registeredInitialLocales.add(initialLocaleCatalog.locale)
    registerCompiledMessages(initialLocaleCatalog.locale, '', initialLocaleCatalog.messages)
  }

  const i18n = useMemo(() => createI18n({ locale }), [locale])

  useEffect(() => {
    if (!enableDevDiagnostics) return
    import('react-scan').then(({ scan }) => scan({ enabled: true }))
  }, [enableDevDiagnostics])

  useEffect(() => {
    const syncDocumentLocale = () => {
      document.documentElement.lang = i18n.getLocale()
    }
    syncDocumentLocale()
    return i18n.subscribe(syncDocumentLocale)
  }, [i18n])

  useEffect(() => {
    let cancelled = false
    let latestRequestId = 0
    const unsubscribe = defaultI18n.subscribeLocale((nextLocale) => {
      const requestId = ++latestRequestId
      Promise.all([loadDevLocale(nextLocale), loadBundledLocale(nextLocale)])
        .then(() => {
          if (cancelled || requestId !== latestRequestId) return
          i18n.setLocale(nextLocale)
        })
        .catch(() => {
          // Keep the active locale when catalog loading fails.
        })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [i18n])

  return <PascalI18nProvider i18n={i18n}>{children}</PascalI18nProvider>
}
