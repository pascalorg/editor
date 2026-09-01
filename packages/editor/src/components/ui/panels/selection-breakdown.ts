import { camelType, type Translator } from './node-display'

/**
 * "1 slab · 1 stair · 2 fences" — one entry per node type in first-appearance
 * order so the line stays stable while shift-clicking. Singular labels come
 * from the i18n catalog (`panel.nodeType.<x>`) lowercased so the panel-title
 * shape matches the existing UI; plural forms use the `_plural` variant in
 * English and the singular form in zh (Chinese does not inflect for number).
 * Missing nodes (stale ids) are skipped; unknown types fall back to the
 * humanized id (`'roof-segment' → 'roof segment'`) so un-translated kinds
 * still render sensibly.
 */
export function formatSelectionBreakdown(
  types: Array<string | null | undefined>,
  t: Translator,
): string {
  const counts = new Map<string, number>()
  for (const type of types) {
    if (!type) continue
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  const parts: string[] = []
  for (const [type, count] of counts) {
    const translated = t(`panel.nodeType.${camelType(type)}`)
    // Un-translated kinds echo the key back; fall back to the humanized id.
    const label = (translated.startsWith('panel.nodeType.') ? type.replace(/-/g, ' ') : translated).toLowerCase()
    let labelPlural: string
    if (translated.startsWith('panel.nodeType.')) {
      labelPlural = `${label}s`
    } else {
      labelPlural = t(`panel.nodeType.${camelType(type)}_plural`).toLowerCase()
    }
    parts.push(`${count} ${count === 1 ? label : labelPlural}`)
  }
  return parts.join(' · ')
}