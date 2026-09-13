/**
 * Sidebar warning presentation — pure grouping logic for the X-Ray status
 * block (day-9 declutter round). The engines mint one warning per INSTANCE
 * (`braced wall line X1 (3 walls, 12.4m): CS-WSP continuous sheathing
 * assumed — R602.10 panel length/spacing not verified` × 10 lines); the
 * sidebar shows one row per CLASS with the instances nested under it.
 *
 * Grouping key — stated choice: the text AFTER the first ': ' separator
 * (the class message). Bones warnings mint as `<instance>: <class message>`
 * — the instance prefix varies (line label, wall count, length), the class
 * message is byte-stable, so "text up to the first colon" would never group
 * the braced lines. Warnings without a ': ' key on their full text. A group
 * only forms from ≥ 2 DISTINCT warnings sharing a class message — identical
 * duplicates are deduped first (the panel's long-standing `new Set` pass),
 * and singletons render as plain verbatim lines.
 *
 * PANEL-ONLY presentation: this module never mutates its input, and nothing
 * here feeds `result.warnings` or the plan-set Flags block — paper prints
 * every warning verbatim, always (blueprint C5 honesty contract).
 */

export type WarningLine =
  | { kind: 'single'; text: string }
  | {
      kind: 'group'
      /** Human class label derived from the instance prefixes ("braced wall lines"). */
      label: string
      /** The shared class message (text after the first ': '), verbatim. */
      message: string
      /** Every member warning, VERBATIM, in first-appearance order. */
      warnings: string[]
    }

/** The separator that splits `<instance>: <class message>`. */
const SEP = ': '

/** Class key: text after the first ': ', or the whole warning when none. */
const classKey = (warning: string): string => {
  const at = warning.indexOf(SEP)
  return at === -1 ? warning : warning.slice(at + SEP.length)
}

/** Instance prefix: text before the first ': ', or '' when none. */
const instancePrefix = (warning: string): string => {
  const at = warning.indexOf(SEP)
  return at === -1 ? '' : warning.slice(0, at)
}

/**
 * Longest common word-prefix of the instance prefixes — the class label.
 * `braced wall line X1 (3 walls, 12.4m)` ∩ `braced wall line X2 (…)` →
 * `braced wall line`. Pluralized (trailing `s`) since a group is plural by
 * construction; empty (nothing in common) falls back to `warnings`.
 */
const groupLabel = (prefixes: string[]): string => {
  const first = (prefixes[0] ?? '').split(/\s+/)
  let common = first.length
  for (const prefix of prefixes.slice(1)) {
    const words = prefix.split(/\s+/)
    let i = 0
    while (i < common && i < words.length && words[i] === first[i]) i += 1
    common = i
  }
  const label = first.slice(0, common).join(' ')
  if (!label) return 'warnings'
  return label.endsWith('s') ? label : `${label}s`
}

/**
 * Dedupe (preserving first-appearance order), then fold repeated-class
 * warnings into groups. Returns presentation rows only — input untouched.
 */
export function groupWarnings(warnings: readonly string[]): WarningLine[] {
  const unique = [...new Set(warnings)]
  const byClass = new Map<string, string[]>()
  for (const warning of unique) {
    const key = classKey(warning)
    const bucket = byClass.get(key)
    if (bucket) bucket.push(warning)
    else byClass.set(key, [warning])
  }
  const lines: WarningLine[] = []
  const grouped = new Set<string>()
  for (const warning of unique) {
    const key = classKey(warning)
    if (grouped.has(key)) continue
    const bucket = byClass.get(key) ?? [warning]
    if (bucket.length < 2) {
      lines.push({ kind: 'single', text: warning })
      continue
    }
    grouped.add(key)
    lines.push({
      kind: 'group',
      label: groupLabel(bucket.map(instancePrefix)),
      message: key,
      warnings: bucket,
    })
  }
  return lines
}

/**
 * Total warning lines when fully expanded — the count in the section title.
 * Equals the deduped warning count (what the sidebar has always shown).
 */
export function warningCount(lines: readonly WarningLine[]): number {
  let count = 0
  for (const line of lines) count += line.kind === 'group' ? line.warnings.length : 1
  return count
}
