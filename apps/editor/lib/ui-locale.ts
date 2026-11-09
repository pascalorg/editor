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
