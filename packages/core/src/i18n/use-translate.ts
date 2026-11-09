'use client'

import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react'
import { defaultI18n, type PascalI18n } from './registry'

const PascalI18nContext = createContext(defaultI18n)

/**
 * Bind a request- or editor-local Pascal scope to React and Lingui.
 *
 * @experimental Unreleased API; signatures may change before the first i18n release.
 */
export function PascalI18nProvider({ children, i18n }: { children: ReactNode; i18n: PascalI18n }) {
  useEffect(() => i18n.retain(), [i18n])
  return createElement(PascalI18nContext.Provider, { value: i18n }, children)
}

/** @experimental Unreleased API; signatures may change before the first i18n release. */
export function usePascalI18n(): PascalI18n {
  const i18n = useContext(PascalI18nContext)
  useSyncExternalStore(
    i18n.subscribe.bind(i18n),
    i18n.getVersion.bind(i18n),
    i18n.getVersion.bind(i18n),
  )
  return i18n
}

/** @experimental Unreleased API; signatures may change before the first i18n release. */
export function useLocale(): string {
  return usePascalI18n().getLocale()
}
