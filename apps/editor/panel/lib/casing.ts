import type { Lang } from './types'

/**
 * The locale each language formats and cases with.
 *
 * `en-GB` rather than `en-US` because dates elsewhere in the app are rendered
 * day-first; the casing rules of the two are identical, so one constant serves
 * both purposes.
 */
export const LOCALE: Record<Lang, string> = { en: 'en-GB', tr: 'tr-TR' }

/**
 * Locale-aware uppercase, extracted from the `<Caps>` component so the rule can
 * be tested without rendering React.
 *
 * Two directions to the Turkish trap, and both bite:
 *
 * - dotted:   'i' → 'İ'  — "izmir" must become "İZMİR", not "IZMIR"
 * - dotless:  'I' → 'ı'  in the *lower* direction, which is why identifiers
 *             cannot be round-tripped through the Turkish locale at all
 *
 * `invariant` is for identifiers rather than prose — role names, permission
 * keys, brand words. Under the Turkish rule "Admin" becomes "ADMİN" and
 * "Editor" becomes "EDİTOR", which are not the names of those roles.
 */
export function toCaps(value: string, lang: Lang, invariant = false): string {
  return value.toLocaleUpperCase(invariant ? LOCALE.en : LOCALE[lang])
}
