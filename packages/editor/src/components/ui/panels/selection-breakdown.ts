/**
 * "1 slab · 1 stair · 2 fences" — one entry per node type in first-appearance
 * order so the line stays stable while shift-clicking. Labels derive from the
 * type id ('roof-segment' → 'roof segment'); pluralization is a simple +s
 * (the codebase has no pluralize helper and no current kind needs one).
 * Missing nodes (stale ids) are skipped.
 */
export function formatSelectionBreakdown(types: Array<string | null | undefined>): string {
  const counts = new Map<string, number>()
  for (const type of types) {
    if (!type) continue
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  const parts: string[] = []
  for (const [type, count] of counts) {
    const label = type.replace(/-/g, ' ')
    parts.push(`${count} ${count === 1 ? label : `${label}s`}`)
  }
  return parts.join(' · ')
}
