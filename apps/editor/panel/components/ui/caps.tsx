'use client';

import { useApp } from '@panel/components/app-providers';
import { toCaps } from '@panel/lib/casing';

/**
 * Locale-aware uppercase, done in JavaScript rather than with CSS.
 *
 * `text-transform: uppercase` is supposed to follow the document language, and
 * `<html lang="tr">` is set — but Chromium still renders "SONRAKI GELIYOR"
 * instead of "SONRAKİ GELİYOR", so the dotted-İ rule silently does not survive
 * the CSS path. Every uppercase label in this UI is dictionary text, and half of
 * it is Turkish, so the transform has to happen where the locale is guaranteed:
 * `String.prototype.toLocaleUpperCase(locale)`.
 *
 * Strings that mix brand names with Turkish (the footer signature, the console
 * meta line) are not routed through here at all — they are written with the
 * glyphs they need, because no single locale is right for both halves.
 */
export function Caps({
  children,
  className,
  invariant = false,
}: {
  children: string;
  className?: string;
  /**
   * Set for identifiers rather than prose — role names, permission keys, brand
   * words. They are data, not UI copy, and the Turkish rule turns "Admin" into
   * "ADMİN" and "Editor" into "EDİTOR". Same trap as the missing İ, in reverse.
   */
  invariant?: boolean;
}) {
  const { lang } = useApp();
  return <span className={className}>{toCaps(children, lang, invariant)}</span>;
}

/** Same rule for callers that need a string rather than an element. */
export function useCaps(): (value: string) => string {
  const { lang } = useApp();
  return (value: string) => toCaps(value, lang);
}
