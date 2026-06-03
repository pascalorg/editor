import type { AssetInput } from '@pascal-app/core'

function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return String(n)
  const rounded = Number(n.toFixed(6))
  return String(rounded)
}

function formatTuple3(tuple: [number, number, number]): string {
  return `[${tuple.map(formatNum).join(', ')}]`
}

/** Serialize one catalog entry to match catalog-items.tsx style. */
export function formatCatalogEntry(entry: AssetInput): string {
  const lines: string[] = ['  {']
  lines.push(`    id: '${escapeString(entry.id)}',`)
  lines.push(`    category: '${escapeString(entry.category)}',`)
  lines.push(`    name: '${escapeString(entry.name)}',`)

  if (entry.tags && entry.tags.length > 0) {
    lines.push('    tags: [')
    for (const tag of entry.tags) {
      lines.push(`      '${escapeString(tag)}',`)
    }
    lines.push('    ],')
  }

  lines.push(`    thumbnail: '${escapeString(entry.thumbnail)}',`)
  lines.push(`    src: '${escapeString(entry.src)}',`)

  if (entry.floorPlanUrl) {
    lines.push(`    floorPlanUrl: '${escapeString(entry.floorPlanUrl)}',`)
  }

  const dimensions = entry.dimensions ?? [1, 1, 1]
  lines.push(`    dimensions: ${formatTuple3(dimensions)},`)

  const offset = entry.offset ?? [0, 0, 0]
  lines.push(`    offset: ${formatTuple3(offset)},`)

  const rotation = entry.rotation ?? [0, 0, 0]
  lines.push(`    rotation: ${formatTuple3(rotation)},`)

  const scale = entry.scale ?? [1, 1, 1]
  lines.push(`    scale: ${formatTuple3(scale)},`)

  if (entry.attachTo) {
    lines.push(`    attachTo: '${entry.attachTo}',`)
  }

  if (entry.surface?.height !== undefined) {
    lines.push(`    surface: { height: ${formatNum(entry.surface.height)} },`)
  }

  if (!lines.at(-1)?.endsWith(',')) {
    lines[lines.length - 1] = `${lines.at(-1)},`
  }

  lines.push('  },')
  return lines.join('\n')
}
