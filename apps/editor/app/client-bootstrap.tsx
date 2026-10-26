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
import { getLocale, setLocale, subscribe } from '@pascal-app/core'
import { registerBundledLocales } from '@pascal-app/editor/locales'
import { type ReactNode, useEffect } from 'react'

registerBundledLocales()

if (typeof window !== 'undefined') {
  const queryLocale = new URLSearchParams(window.location.search).get('lang')
  if (queryLocale) setLocale(queryLocale)
}

export function ClientBootstrap({
  children,
  enableDevDiagnostics,
}: {
  children: ReactNode
  enableDevDiagnostics: boolean
}) {
  useEffect(() => {
    if (!enableDevDiagnostics) return
    import('react-scan').then(({ scan }) => scan({ enabled: true }))
  }, [enableDevDiagnostics])
  useEffect(() => {
    const syncDocumentLocale = () => {
      document.documentElement.lang = getLocale()
    }
    syncDocumentLocale()
    return subscribe(syncDocumentLocale)
  }, [])
  return children
}
