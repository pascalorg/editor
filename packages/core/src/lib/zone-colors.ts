import type { AnyNode, AnyNodeId, ZoneNode } from '../schema'

/** The colour picker's swatches, in hue order. */
export const ZONE_COLOR_PALETTE = [
  '#ef4444', // Red        0°
  '#f97316', // Orange    30°
  '#f59e0b', // Amber     45°
  '#84cc16', // Lime      85°
  '#22c55e', // Green    142°
  '#10b981', // Emerald  160°
  '#06b6d4', // Cyan     190°
  '#3b82f6', // Blue     217°
  '#6366f1', // Indigo   239°
  '#a855f7', // Violet   270°
  '#64748b', // Dark gray
  '#cccccc', // Light gray
] as const

/** What a zone is created with when nobody picked a colour. */
export const DEFAULT_ZONE_COLOR = '#3b82f6'

// The creation defaults zones were written with: the schema's blue, and the
// lighter blue the AI scene agent stamped on every room it built.
const UNPICKED_COLORS = new Set([DEFAULT_ZONE_COLOR, '#60a5fa'])

/** Whether a stored zone colour is a creation default rather than a choice. */
export function isUnpickedZoneColor(color: string): boolean {
  return UNPICKED_COLORS.has(color.toLowerCase())
}

// Greys read as "no colour", so derived colours stay on the hues.
const DERIVED_COLORS = ZONE_COLOR_PALETTE.slice(0, 10)
// Zones closer than a wall's thickness count as neighbours.
const NEIGHBOUR_GAP = 0.35

type Resolve = (id: AnyNodeId) => AnyNode | undefined
type Bounds = [number, number, number, number]

function bounds(zone: ZoneNode): Bounds {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of zone.polygon) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return [minX, minZ, maxX, maxZ]
}

function touches(a: Bounds, b: Bounds): boolean {
  return (
    a[0] - NEIGHBOUR_GAP <= b[2] &&
    b[0] - NEIGHBOUR_GAP <= a[2] &&
    a[1] - NEIGHBOUR_GAP <= b[3] &&
    b[1] - NEIGHBOUR_GAP <= a[3]
  )
}

function hash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * The colour every zone on one parent shows. A zone still on a creation
 * default has no chosen colour: it shows a derived one instead — its id picks
 * a starting hue, and it steps past any hue a neighbouring zone already shows
 * (chosen colours first, then derived ones in id order). Pure and id-seeded, so
 * every client and every reload agrees, and nothing is written to the scene.
 */
export function deriveZoneColors(zones: readonly ZoneNode[]): Map<string, string> {
  const colors = new Map<string, string>()
  const boxes = new Map(zones.map((zone) => [zone.id, bounds(zone)]))
  for (const zone of zones) if (!isUnpickedZoneColor(zone.color)) colors.set(zone.id, zone.color)
  const unset = zones
    .filter((zone) => isUnpickedZoneColor(zone.color))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const zone of unset) {
    const box = boxes.get(zone.id)!
    const taken = new Set<string>()
    for (const other of zones) {
      const color = colors.get(other.id)
      if (color && other.id !== zone.id && touches(box, boxes.get(other.id)!))
        taken.add(color.toLowerCase())
    }
    const start = hash(zone.id) % DERIVED_COLORS.length
    let pick: string = DERIVED_COLORS[start]!
    for (let step = 0; step < DERIVED_COLORS.length; step++) {
      const candidate = DERIVED_COLORS[(start + step) % DERIVED_COLORS.length]!
      if (!taken.has(candidate)) {
        pick = candidate
        break
      }
    }
    colors.set(zone.id, pick)
  }
  return colors
}

const cache = new WeakMap<AnyNode, { zones: ZoneNode[]; colors: Map<string, string> }>()

/** The colour a zone shows: its chosen colour, else the derived one (`deriveZoneColors`). */
export function zoneDisplayColor(zone: ZoneNode, resolve: Resolve): string {
  if (!isUnpickedZoneColor(zone.color)) return zone.color
  const parent = zone.parentId ? resolve(zone.parentId as AnyNodeId) : undefined
  if (!(parent && 'children' in parent && Array.isArray(parent.children))) {
    return deriveZoneColors([zone]).get(zone.id)!
  }
  const zones = (parent.children as AnyNodeId[])
    .map((id) => resolve(id))
    .filter((node): node is ZoneNode => node?.type === 'zone')
  const cached = cache.get(parent)
  if (
    cached &&
    cached.zones.length === zones.length &&
    cached.zones.every((node, index) => node === zones[index])
  ) {
    return cached.colors.get(zone.id) ?? deriveZoneColors([zone]).get(zone.id)!
  }
  const colors = deriveZoneColors(zones)
  cache.set(parent, { zones, colors })
  return colors.get(zone.id) ?? deriveZoneColors([zone]).get(zone.id)!
}
