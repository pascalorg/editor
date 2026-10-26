'use client'

import { useCallback, useSyncExternalStore } from 'react'
import {
  getI18nVersion,
  getLocale,
  subscribe,
  type TranslationMessage,
  type TranslationParams,
  translate,
} from './registry'

const SERVER_SNAPSHOT = -1

export type Translate = (
  key: string,
  englishDefault: TranslationMessage,
  params?: TranslationParams,
) => string

export function useLocale(): string {
  const version = useSyncExternalStore(subscribe, getI18nVersion, () => SERVER_SNAPSHOT)
  return version === SERVER_SNAPSHOT ? 'en' : getLocale()
}

/**
 * The server and hydration snapshot always uses the in-code English message.
 * Once the client subscribes, the active locale is read from the registry and
 * locale or message registrations re-render the component.
 */
export function useTranslate(): Translate {
  const locale = useLocale()

  return useCallback(
    (key, englishDefault, params) => translate(key, englishDefault, params, locale),
    [locale],
  )
}
