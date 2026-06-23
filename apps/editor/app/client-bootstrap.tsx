'use client'

import '@/i18n/init'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/provider'

export function ClientBootstrap({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>
}
