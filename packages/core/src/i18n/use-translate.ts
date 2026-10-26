'use client'

import { useCallback, useSyncExternalStore } from 'react'
import {
  getI18nVersion,
  subscribe,
  translate,
  type TranslationMessage,
  type TranslationParams,
} from './registry'

const SERVER_SNAPSHOT = -1

export type Translate = (
  key: string,
  englishDefault: TranslationMessage,
  params?: TranslationParams,
) => string

/**
 * The server and hydration snapshot always uses the in-code English message.
 * Once the client subscribes, the active locale is read from the registry and
 * locale or message registrations re-render the component.
 */
export function useTranslate(): Translate {
  const version = useSyncExternalStore(subscribe, getI18nVersion, () => SERVER_SNAPSHOT)

  return useCallback(
    (key, englishDefault, params) =>
      translate(key, englishDefault, params, version === SERVER_SNAPSHOT ? 'en' : undefined),
    [version],
  )
}
