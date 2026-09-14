import { MATERIAL_CATALOG, type MaterialCatalogItem } from '../material-library'
import type { ProceduralItemNode } from './node'

export type LibraryColorMatch = {
  ref: `library:${string}`
  color: string
  name: string
  distance: number
}

function hexToLab(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null
  const linear = (offset: number) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  const r = linear(1)
  const g = linear(3)
  const b = linear(5)
  // sRGB uses D65; normalize XYZ by that white point before converting to Lab.
  const f = (value: number) =>
    value > (6 / 29) ** 3 ? Math.cbrt(value) : value / (3 * (6 / 29) ** 2) + 4 / 29
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047)
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b)
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

export function nearestLibraryColorRef(
  hex: string,
  catalog: readonly MaterialCatalogItem[] = MATERIAL_CATALOG,
): LibraryColorMatch | null {
  const lab = hexToLab(hex)
  if (!lab) return null
  let nearest: LibraryColorMatch | null = null
  for (const entry of catalog) {
    // Flat swatches are in `colors` and have no populated maps, including non-albedo maps.
    if (entry.category !== 'colors' || Object.values(entry.preset.maps).some(Boolean)) continue
    const color = entry.preset.mapProperties.color
    const candidate = hexToLab(color)
    if (!candidate) continue
    const distance = Math.hypot(lab[0] - candidate[0], lab[1] - candidate[1], lab[2] - candidate[2])
    if (!nearest || distance < nearest.distance) {
      nearest = { ref: `library:${entry.id}`, color, name: entry.label, distance }
    }
  }
  return nearest
}

export function snapProceduralSlotsToLibrary(
  node: ProceduralItemNode,
  options: { keepOverrides: true } = { keepOverrides: true },
): ProceduralItemNode['slots'] {
  const slots = { ...node.slots }
  for (const slot of node.recipe.slots) {
    if (options.keepOverrides && Object.hasOwn(node.slots, slot.id)) continue
    const nearest = nearestLibraryColorRef(slot.color)
    if (nearest) slots[slot.id] = nearest.ref
  }
  return slots
}
