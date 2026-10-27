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
import { registerBundledLocales } from '@pascal-app/editor/locales'
import { type ReactNode, useEffect, useMemo } from 'react'
import { registerDevLocales } from '@/lib/dev-locales'

registerBundledLocales()
registerDevLocales()

export function ClientBootstrap({
  children,
  enableDevDiagnostics,
  locale,
}: {
  children: ReactNode
  enableDevDiagnostics: boolean
  locale: string
}) {
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
    return defaultI18n.subscribeLocale((nextLocale) => i18n.setLocale(nextLocale))
  }, [i18n])

  return <PascalI18nProvider i18n={i18n}>{children}</PascalI18nProvider>
}
