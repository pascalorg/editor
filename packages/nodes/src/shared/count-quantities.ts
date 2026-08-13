import type { AnyNode, QuantitiesContribution, QuantityRow } from '@pascal-app/core'

/**
 * A quantities contribution for kinds whose only useful number is "how many".
 *
 * Doors, windows, columns and MEP terminals are counted, not measured — their
 * sizes live in a schedule, not a takeoff total. `group` optionally splits the
 * tally, so doors can come out per type without each kind writing the same
 * grouping loop.
 */
export function countQuantities<N extends AnyNode>(
  label: string,
  group?: (node: N) => string | undefined,
): QuantitiesContribution<N> {
  return (nodes) => {
    const rows: QuantityRow[] = nodes.map((node) => ({
      key: 'count',
      label: 'Count',
      unit: 'count' as const,
      value: 1,
      ...(group ? { group: group(node) } : {}),
    }))
    return rows.length > 0 ? { label, rows } : null
  }
}
