'use client'

import { useEffect, type ReactNode } from 'react'
import { useLocale } from '@/lib/i18n'

/**
 * Mirrors the active locale on `<html lang>` so screen readers and search
 * engines see the correct language after hydration.
 *
 * Must live in a client component (the parent layout exports `metadata`,
 * which is server-only) and must defer the DOM write to `useEffect` —
 * mutating `document` during render would warn under React 19.
 */
export function HtmlLangSync({ children }: { children: ReactNode }) {
  const { locale } = useLocale()
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return <>{children}</>
}