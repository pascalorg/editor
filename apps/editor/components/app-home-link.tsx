'use client'

import { usePascalI18n } from '@pascal-app/core'
import Link from 'next/link'
import type { ReactNode } from 'react'

/** Server pages render `AppHeader`, so the translated link label lives in this client leaf. */
export function AppHomeLink({ children }: { children: ReactNode }) {
  const i18n = usePascalI18n()
  return (
    <Link
      aria-label={i18n._({ id: 'app.appShell.pascalHome', message: 'Pascal home' })}
      className="-mx-2 flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-accent"
      href="/"
    >
      {children}
    </Link>
  )
}
