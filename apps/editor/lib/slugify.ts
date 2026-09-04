/**
 * Stable anchor ids for headings, safe for Turkish text: the dotted/dotless
 * i pair and the other Turkish letters are folded to ASCII rather than
 * dropped, so `Sahne çizmek` and `Sahne cizmek` cannot collide with each
 * other or vanish into an empty id.
 */
const FOLD: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  i: 'i',
  İ: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[çğıiİöşü]/g, (char) => FOLD[char] ?? char)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}
