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
import { type ReactNode, useEffect } from 'react'

export function ClientBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    // Loaded here (not via a `<Script>` tag in <head>) to avoid React's
    // "script inside a React component" hydration warning. The package
    // is already a direct dep, so we don't need the CDN auto-global.
    import('react-scan').then(({ scan }) => scan({ enabled: true }))
  }, [])
  return children
}
