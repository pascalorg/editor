'use client'

// Side-effect import: loads every built-in node kind into the registry
// on the client so the first `<Viewer>` has renderers to dispatch to.
// Mounted from `app/layout.tsx` so every route is covered.
import '../lib/bootstrap'
import type { ReactNode } from 'react'

export function ClientBootstrap({ children }: { children: ReactNode }) {
  return children
}
