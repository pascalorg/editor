import { type I18nLocale, translateReactNode } from '@pascal-app/editor/i18n'
import type { ReactNode } from 'react'

export function ServerLocalizedContent({
  children,
  locale,
}: {
  children: ReactNode
  locale: I18nLocale
}) {
  return translateReactNode(children, locale)
}
