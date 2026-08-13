'use client'

import { Fragment, type ReactNode, useCallback } from 'react'
import { translate, translateReactNode } from './i18n-core'
import { useUiPreferences } from './ui-preferences'

export { translate, translateReactNode } from './i18n-core'

export function useTranslation() {
  const locale = useUiPreferences((state) => state.locale)
  return useCallback((text: string) => translate(text, locale), [locale])
}

export function LocalizedContent({ children }: { children: ReactNode }) {
  const locale = useUiPreferences((state) => state.locale)
  return <Fragment>{translateReactNode(children, locale)}</Fragment>
}
