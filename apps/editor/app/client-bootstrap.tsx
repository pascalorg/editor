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
import type { ReactNode } from 'react'

export function ClientBootstrap({ children }: { children: ReactNode }) {
  return children
}
