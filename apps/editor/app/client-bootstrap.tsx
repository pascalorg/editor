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
  const i18n = useMemo(() => {
    if (initialLocaleCatalog) {
      registerCompiledMessages(initialLocaleCatalog.locale, '', initialLocaleCatalog.messages)
    }
    return createI18n({ locale })
  }, [initialLocaleCatalog, locale])

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
    return defaultI18n.subscribeLocale((nextLocale) => {
      void Promise.all([loadDevLocale(nextLocale), loadBundledLocale(nextLocale)]).finally(() => {
        i18n.setLocale(nextLocale)
      })
    })
  }, [i18n])

  return <PascalI18nProvider i18n={i18n}>{children}</PascalI18nProvider>
}
