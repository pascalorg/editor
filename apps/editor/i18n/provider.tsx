'use client'

import { useEffect, type ReactNode } from 'react'

const LOCALE = 'zh-CN'

export function I18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = LOCALE
  }, [])

  return children
}
