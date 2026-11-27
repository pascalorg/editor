export const PASCAL_LOCALE_HEADER = 'x-pascal-locale'

export function resolveUiLocale(value: string | null | undefined): string {
  const requested = value?.trim()
  if (!requested) return 'en'
  try {
    return Intl.getCanonicalLocales(requested)[0] ?? 'en'
  } catch {
    return 'en'
  }
}

/**
 * Computes the next locale when the `?lang=` query parameter changes during a
 * client-side navigation. Returns `null` when no change should occur.
 */
export function resolveClientLangNavigation(
  previousLangParam: string | null | undefined,
  nextLangParam: string | null,
  defaultLocale: string,
): string | null {
  if (previousLangParam === undefined) {
    return nextLangParam !== null ? resolveUiLocale(nextLangParam) : null
  }
  if (previousLangParam === nextLangParam) return null
  return nextLangParam === null ? defaultLocale : resolveUiLocale(nextLangParam)
}

/**
 * Coordinates locale switches so bundled catalogs finish loading before the
 * active i18n locale flips, stale in-flight switches are ignored, and rejected
 * loads leave the active locale untouched.
 */
export function createLocaleApplier({
  isLoaded,
  isActive = () => true,
  loadLocale,
  setLocale,
}: {
  isLoaded?: (locale: string) => boolean
  isActive?: () => boolean
  loadLocale: (locale: string) => Promise<unknown>
  setLocale: (locale: string) => void
}): {
  apply: (nextLocale: string) => Promise<boolean>
} {
  let requestId = 0

  return {
    async apply(nextLocale: string): Promise<boolean> {
      const currentRequest = ++requestId
      if (isLoaded?.(nextLocale)) {
        if (!isActive()) return false
        setLocale(nextLocale)
        return true
      }
      try {
        await loadLocale(nextLocale)
      } catch {
        return false
      }
      if (currentRequest !== requestId || !isActive()) return false
      setLocale(nextLocale)
      return true
    },
  }
}
