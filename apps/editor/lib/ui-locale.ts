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
