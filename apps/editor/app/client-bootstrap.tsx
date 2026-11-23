'use client'

// Loads `@pascal-app/nodes`' built-in plugin into the node registry on the
// client. Mounted from `layout.tsx` so every page in the standalone
// editor gets the registry populated before its first `<Viewer>` /
// `<Editor>` mounts — without this the registry is empty on the client
// (the server registers in its own module instance, which is unreachable
// from hydrated pages) and every `NodeRenderer` resolves to `null`. The
// `loaded` guard inside `../lib/bootstrap` keeps the side effect
// idempotent under HMR.
import '../lib/bootstrap'
import { createI18n, defaultI18n, PascalI18nProvider } from '@pascal-app/core'
import {
  type LocaleCatalog,
  loadBundledLocale,
  registerBundledCatalog,
} from '@pascal-app/editor/locales'
import { useSearchParams } from 'next/navigation'
import { type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import { registerDevLocales } from '@/lib/dev-locales'
import { resolveClientLangNavigation } from '@/lib/ui-locale'

registerDevLocales()

function LocaleQuerySync({
  defaultLocale,
  onLocaleChange,
}: {
  defaultLocale: string
  onLocaleChange: (nextLocale: string) => void
}) {
  const searchParams = useSearchParams()
  const langParam = searchParams.get('lang')
  const previousLangRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const nextLocale = resolveClientLangNavigation(
      previousLangRef.current,
      langParam,
      defaultLocale,
    )
    previousLangRef.current = langParam
    if (nextLocale !== null) onLocaleChange(nextLocale)
  }, [langParam, defaultLocale, onLocaleChange])

  return null
}

export function ClientBootstrap({
  children,
  enableDevDiagnostics,
  initialCatalog = null,
  locale,
}: {
  children: ReactNode
  enableDevDiagnostics: boolean
  initialCatalog?: LocaleCatalog | null
  locale: string
}) {
  const initialCatalogRef = useRef(initialCatalog)
  initialCatalogRef.current = initialCatalog

  const i18n = useMemo(() => {
    if (initialCatalogRef.current) registerBundledCatalog(initialCatalogRef.current)
    return createI18n({ locale })
  }, [locale])

  const applyLocale = useCallback(
    (nextLocale: string) => {
      i18n.setLocale(nextLocale)
      void loadBundledLocale(nextLocale)
    },
    [i18n],
  )

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
    return defaultI18n.subscribeLocale((nextLocale) => applyLocale(nextLocale))
  }, [applyLocale])

  return (
    <PascalI18nProvider i18n={i18n}>
      <Suspense fallback={null}>
        <LocaleQuerySync defaultLocale={locale} onLocaleChange={applyLocale} />
      </Suspense>
      {children}
    </PascalI18nProvider>
  )
}
